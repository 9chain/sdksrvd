
var path = require('path');
var fs = require('fs');
var util = require('util');
var os = require('os');

var utils = require('fabric-client/lib/utils.js');
var copService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
var CryptoSuite = require('fabric-client/lib/impl/CryptoSuite_ECDSA_AES.js');
var KeyStore = require('fabric-client/lib/impl/CryptoKeyStore.js');
var ecdsaKey = require('fabric-client/lib/impl/ecdsa/key.js');
const BlockDecoder = require('fabric-client/lib/BlockDecoder.js');
var User = require('fabric-client/lib/User.js');

const logger = require("winston")
const { SDKError } = require("./exception")
const { FabricCfg } = require("./config")


var Client = require('fabric-client');
Client.addConfigFile('config.json');
Client.setConfigSetting('request-timeout', 60000);
ORGS = Client.getConfigSetting('test-network');

// directory for file based KeyValueStore
var KVS = path.join(os.tmpdir(), 'hfc', 'hfc-kvs');

var tlsOptions = {
    trustedRoots: [],
    verify: false
};

class Sdk {
    constructor() {
        this.client = new Client();
        this.channelMap = new Map();
    }

    storePathForOrg(org) {
        return KVS + '_' + org;
    };

    getChannel(channel) {
        channel = channel || FabricCfg.DefaultChannel
        return this.channelMap.get(channel).channel;
    }

    getEventHubs(channel) {
        channel = channel || FabricCfg.DefaultChannel
        return this.channelMap.get(channel).eventhubs;
    }

    async getMember(username, password, userOrg) {
        var caUrl = ORGS[userOrg].ca.url;

        var user = await this.client.getUserContext(username, true)

        return new Promise((resolve, reject) => {
            if (user && user.isEnrolled()) {
                logger.debug('Successfully loaded member from persistence');
                return resolve(user);
            }

            var member = new User(username);
            var cryptoSuite = this.client.getCryptoSuite();
            if (!cryptoSuite) {
                cryptoSuite = Client.newCryptoSuite();
                if (userOrg) {
                    cryptoSuite.setCryptoKeyStore(Client.newCryptoKeyStore({ path: this.storePathForOrg(ORGS[userOrg].name) }));
                    this.client.setCryptoSuite(cryptoSuite);
                }
            }
            member.setCryptoSuite(cryptoSuite);

            // need to enroll it with CA server
            var cop = new copService(caUrl, tlsOptions, ORGS[userOrg].ca.name, cryptoSuite);

            return cop.enroll({
                enrollmentID: username,
                enrollmentSecret: password
            }).then((enrollment) => {
                logger.debug('Successfully enrolled user \'' + username + '\'');
                return member.setEnrollment(enrollment.key, enrollment.certificate, ORGS[userOrg].mspid);
            }).then(() => {
                var skipPersistence = false;
                if (!this.client.getStateStore()) {
                    skipPersistence = true;
                }
                return this.client.setUserContext(member, skipPersistence);
            }).then(() => {
                return resolve(member);
            }).catch((err) => {
                logger.error('Failed to enroll and persist user. Error: ' + err.stack ? err.stack : err);
            });
        });
    }

    async initChannel(channel, userOrg) {
        this.channelMap.set(channel, {
            channel: this.client.newChannel(channel),
            eventhubs: []
        })

        var caRootsPath = ORGS.orderer.tls_cacerts;
        let caData = fs.readFileSync(caRootsPath)
        let caroots = Buffer.from(caData).toString();

        this.getChannel(channel).addOrderer(
            this.client.newOrderer(
                ORGS.orderer.url,
                {
                    'pem': caroots,
                    'ssl-target-name-override': ORGS.orderer['server-hostname']
                }
            )
        );

        const admin = await this.getMember('admin', 'adminpw', userOrg)

        // set up the channel to use each org's 'peer1' for
        // both requests and events
        for (let key in ORGS) {
            if (ORGS.hasOwnProperty(key) && typeof ORGS[key].peer1 !== 'undefined') {
                let data = fs.readFileSync(ORGS[key].peer1['tls_cacerts'])
                let peer = this.client.newPeer(
                    ORGS[key].peer1.requests,
                    {
                        pem: Buffer.from(data).toString(),
                        'ssl-target-name-override': ORGS[key].peer1['server-hostname']
                    }
                );
                this.getChannel(channel).addPeer(peer);
            }
        }

        // an event listener can only register with a peer in its own org
        let data = fs.readFileSync(ORGS[userOrg].peer1['tls_cacerts'])
        let eh = this.client.newEventHub();
        eh.setPeerAddr(
            ORGS[userOrg].peer1.events,
            {
                pem: Buffer.from(data).toString(),
                'ssl-target-name-override': ORGS[userOrg].peer1['server-hostname'],
                'grpc.http2.keepalive_time': 15
            }
        );

        eh.connect();
        this.getEventHubs(channel).push(eh);
        return this.getChannel(channel).initialize();
    }

    closeChannel(channel) {
        var c = this.getChannel(channel)
        let peers = c.getPeers();
        for (let i in peers) {
            let peer = peers[i];
            peer.close();
        }
        let orderers = c.getOrderers();
        for (let i in orderers) {
            let orderer = orderers[i];
            orderer.close();
        }

        var eventhubs = this.getEventHubs(channel)
        for (var key in eventhubs) {
            var eventhub = eventhubs[key];
            if (eventhub && eventhub.isconnected()) {
                logger.debug('Disconnecting the event hub');
                eventhub.disconnect(); //this will also close the connection
            }
        }
    }

    close() {
        // all done, shutdown connections on all
        for (var key in this.channelMap) {
            this.closeChannel(key)
        }
    }

    newTransactionID() {
        return this.client.newTransactionID();
    }

    queryTransaction(channel, txId, key, subChannel) {
        return this.getChannel(channel).queryTransaction(txId).then((processTrans) => {
            var header = processTrans['transactionEnvelope']['payload']['header']
            var data = processTrans['transactionEnvelope']['payload']['data']
            var writes = data.actions[0].payload.action.proposal_response_payload.extension.results.ns_rwset[1].rwset.writes

            var result = []
            if (writes) {
                for (let i = 0; i < writes.length; ++i) {
                    var write = writes[i]
                    var pos = write.key.indexOf(subChannel);
                    if (pos > 0) {
                        write.key = write.key.substr(subChannel.length+1);
                    }

                    if (!key || key === write.key) {
                        result.push({ write })
                    }
                }
            }

            return {
                'tx_id': header.channel_header.tx_id,
                'timestamp': header.channel_header.timestamp,
                'channel_id': header.channel_header.channel_id,
                'type': BlockDecoder.HeaderType.convertToString(header.channel_header.type),
                'data': result
            }
        }, (err) => {
            logger.error('Failed to send query transaction due to error: ' + err.stack ? err.stack : err);
            throw new SDKError('undefine', 'Failed, got error on query transaction:' + err);
        });
    }

    queryChaincode(channel, reqParam) {
        return this.getChannel(channel).queryByChaincode(reqParam).then((response_payloads) => {
            if (response_payloads) {
                for (let i = 0; i < response_payloads.length; i++) {
                    logger.debug(response_payloads[i].toString('utf8'))
                    if (i === 0)
                        return response_payloads[i].toString('utf8')
                }
                logger.error('response_payloads return null');
                throw new SDKError('undefine', 'Get response return null');
            } else {
                logger.error('response_payloads is null');
                throw new SDKError('undefine', 'Failed to get response on query');
            }
        }, (err) => {
            logger.error('Failed to send query due to error: ' + err.stack ? err.stack : err);
            throw new SDKError('undefine', 'Failed, got error on query:' + err);
        });
    }

    invokeChaincode(rid, channel, reqParam) {
        var tx_id = reqParam.txId
        logger.debug(' orglist:: ', this.getChannel(channel).getOrganizations());

        return this.getChannel(channel).sendTransactionProposal(reqParam).then((results) => {
            var proposalResponses = results[0];
            var proposal = results[1];
            var all_good = true;

            for (var i in proposalResponses) {
                let one_good = false;
                let proposal_response = proposalResponses[i];
                if (proposal_response.response && proposal_response.response.status === 200) {
                    logger.debug('transaction proposal has response status of good');
                    one_good = this.getChannel(channel).verifyProposalResponse(proposal_response);
                    if (one_good) {
                        logger.debug(' transaction proposal signature and endorser are valid');
                    }
                } else {
                    logger.error('transaction proposal was bad');
                }
                all_good = all_good & one_good;
            }
            if (all_good) {
                // check all the read/write sets to see if the same, verify that each peer
                // got the same results on the proposal
                all_good = this.getChannel(channel).compareProposalResponseResults(proposalResponses);
                logger.debug('compareProposalResponseResults exection did not throw an error');
                if (all_good) {
                    logger.debug(' All proposals have a matching read/writes sets');
                }
                else {
                    logger.error(' All proposals do not have matching read/write sets');
                }
            }
            if (all_good) {
                // check to see if all the results match
                logger.debug('Successfully sent Proposal and received ProposalResponse');
                logger.debug(util.format('Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s", metadata - "%s", endorsement signature: %s', proposalResponses[0].response.status, proposalResponses[0].response.message, proposalResponses[0].response.payload, proposalResponses[0].endorsement.signature));
                var request = {
                    proposalResponses: proposalResponses,
                    proposal: proposal
                };

                // set the transaction listener and set a timeout of 30sec
                // if the transaction did not get committed within the timeout period,
                // fail the test
                var deployId = tx_id.getTransactionID();

                var eventPromises = [];
                this.getEventHubs(channel).forEach((eh) => {
                    let txPromise = new Promise((resolve, reject) => {
                        let handle = setTimeout(reject, 120000);

                        eh.registerTxEvent(deployId.toString(),
                            (tx, code) => {
                                clearTimeout(handle);
                                eh.unregisterTxEvent(deployId);

                                if (code !== 'VALID') {
                                    logger.error('The balance transfer transaction was invalid, code = ' + code);
                                    reject();
                                } else {
                                    logger.debug('The balance transfer transaction has been committed on peer ' + eh.getPeerAddr());
                                    resolve();
                                }
                            },
                            (err) => {
                                clearTimeout(handle);
                                logger.debug('Successfully received notification of the event call back being cancelled for ' + deployId);
                                resolve();
                            }
                        );
                    });

                    eventPromises.push(txPromise);
                });

                var sendPromise = this.getChannel(channel).sendTransaction(request);
                return Promise.all([sendPromise].concat(eventPromises))
                    .then((results) => {
                        logger.debug(' event promise all complete and testing complete');
                        return results[0]; // the first returned value is from the 'sendPromise' which is from the 'sendTransaction()' call
                    }).catch((err) => {
                        logger.error('Failed to send transaction and get notifications within the timeout period.');
                        throw new SDKError(rid, 'Failed to send transaction and get notifications within the timeout period.');
                    });
            } else {
                logger.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                throw new SDKError(rid, 'Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
            }
        }, (err) => {
            logger.error('Failed to send proposal due to error: ' + err.stack ? err.stack : err);
            throw new SDKError(rid, 'Failed to send proposal due to error: ' + err);
        }).then((response) => {
            if (response.status === 'SUCCESS') {
                logger.debug('Successfully sent transaction to the orderer. TX_ID=' + '\'' + tx_id.getTransactionID() + '\'');
                logger.debug('invokeChaincode end');
                return { 'rid': rid, 'response': response, 'txId': tx_id.getTransactionID() };
            } else {
                logger.error('Failed to order the transaction. Error code: ' + response.status);
                throw new SDKError(rid, 'Failed to order the transaction. Error code: ' + response.status);
            }
        }, (err) => {
            logger.error('Failed to send transaction due to error: ' + err.stack ? err.stack : err);
            throw new SDKError(rid, 'Failed to send transaction due to error: ' + err);
        });
    }
}

module.exports = { Sdk }