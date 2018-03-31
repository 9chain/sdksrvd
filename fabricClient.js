var path = require('path');
var fs = require('fs');
var util = require('util');
var os = require('os');

var utils = require('fabric-client/lib/utils.js');
var copService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
var CryptoSuite = require('fabric-client/lib/impl/CryptoSuite_ECDSA_AES.js');
var KeyStore = require('fabric-client/lib/impl/CryptoKeyStore.js');
var ecdsaKey = require('fabric-client/lib/impl/ecdsa/key.js');
var User = require('fabric-client/lib/User.js');
//var logger = utils.getLogger('fabric');
const logger = require("winston")
const { SDKError } = require("./exception")
const { FabricCfg } = require("./config")


var Client = require('fabric-client');

Client.addConfigFile('config.json');
ORGS = Client.getConfigSetting('test-network');

var client = new Client();
var channel = client.newChannel(FabricCfg.DefaultChannel);



var tempdir = path.join(os.tmpdir(), 'hfc');

var eventhubs = [];

var tlsOptions = {
    trustedRoots: [],
    verify: false
};

function getTempDir() {
    fs.ensureDirSync(tempdir);
    return tempdir;
};

// directory for file based KeyValueStore
var KVS = path.join(tempdir, 'hfc-kvs');
function storePathForOrg(org) {
    return KVS + '_' + org;
};

function getMember(username, password, client, userOrg) {
    var caUrl = ORGS[userOrg].ca.url;

    return client.getUserContext(username, true)
        .then((user) => {
            return new Promise((resolve, reject) => {
                if (user && user.isEnrolled()) {
                    logger.debug('Successfully loaded member from persistence');
                    return resolve(user);
                }

                var member = new User(username);
                var cryptoSuite = client.getCryptoSuite();
                if (!cryptoSuite) {
                    cryptoSuite = Client.newCryptoSuite();
                    if (userOrg) {
                        cryptoSuite.setCryptoKeyStore(Client.newCryptoKeyStore({ path: storePathForOrg(ORGS[userOrg].name) }));
                        client.setCryptoSuite(cryptoSuite);
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
                    if (!client.getStateStore()) {
                        skipPersistence = true;
                    }
                    return client.setUserContext(member, skipPersistence);
                }).then(() => {
                    return resolve(member);
                }).catch((err) => {
                    logger.error('Failed to enroll and persist user. Error: ' + err.stack ? err.stack : err);
                });
            });
        });
}

async function init(userOrg) {
    logger.debug('invokeChaincode begin');
    Client.setConfigSetting('request-timeout', 60000);

    var caRootsPath = ORGS.orderer.tls_cacerts;
    let caData = fs.readFileSync(caRootsPath)
    let caroots = Buffer.from(caData).toString();

    channel.addOrderer(
        client.newOrderer(
            ORGS.orderer.url,
            {
                'pem': caroots,
                'ssl-target-name-override': ORGS.orderer['server-hostname']
            }
        )
    );

    const admin = await getMember('admin', 'adminpw', client, userOrg)

    logger.debug('get member admin');

    // set up the channel to use each org's 'peer1' for
    // both requests and events
    for (let key in ORGS) {
        if (ORGS.hasOwnProperty(key) && typeof ORGS[key].peer1 !== 'undefined') {
            let data = fs.readFileSync(ORGS[key].peer1['tls_cacerts'])
            let peer = client.newPeer(
                ORGS[key].peer1.requests,
                {
                    pem: Buffer.from(data).toString(),
                    'ssl-target-name-override': ORGS[key].peer1['server-hostname']
                }
            );
            channel.addPeer(peer);
        }
    }

    // an event listener can only register with a peer in its own org
    let data = fs.readFileSync(ORGS[userOrg].peer1['tls_cacerts'])
    let eh = client.newEventHub();
    eh.setPeerAddr(
        ORGS[userOrg].peer1.events,
        {
            pem: Buffer.from(data).toString(),
            'ssl-target-name-override': ORGS[userOrg].peer1['server-hostname'],
            'grpc.http2.keepalive_time': 15
        }
    );

    eh.connect();
    eventhubs.push(eh);
    return channel.initialize(); 
}

function close() {
    // all done, shutdown connections on all
    let peers = channel.getPeers();
    for (let i in peers) {
        let peer = peers[i];
        peer.close();
    }
    let orderers = channel.getOrderers();
    for (let i in orderers) {
        let orderer = orderers[i];
        orderer.close();
    }

    for (var key in eventhubs) {
        var eventhub = eventhubs[key];
        if (eventhub && eventhub.isconnected()) {
            logger.debug('Disconnecting the event hub');
            eventhub.disconnect(); //this will also close the connection
        }
    }
}

function newTransactionID() {
    return client.newTransactionID();
}

function invokeChaincode(rid, reqParam) {
    var tx_id = reqParam.txId
    logger.debug(' orglist:: ', channel.getOrganizations());

    return channel.sendTransactionProposal(reqParam).then((results) => {
        var proposalResponses = results[0];
        var proposal = results[1];
        var all_good = true;

        for (var i in proposalResponses) {
            let one_good = false;
            let proposal_response = proposalResponses[i];
            if (proposal_response.response && proposal_response.response.status === 200) {
                logger.debug('transaction proposal has response status of good');
                one_good = channel.verifyProposalResponse(proposal_response);
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
            all_good = channel.compareProposalResponseResults(proposalResponses);
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
            eventhubs.forEach((eh) => {
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

            var sendPromise = channel.sendTransaction(request);
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
        throw new SDKError(rid, 'Failed to send proposal due to error: ' + err.stack ? err.stack : err);
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
        throw new SDKError(rid, 'Failed to send transaction due to error: ' + err.stack ? err.stack : err);
    });
};

function queryChaincode(reqParam) {
    return channel.queryByChaincode(reqParam).then((response_payloads) => {
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
        throw new SDKError('undefine', 'Failed, got error on query');
    });
};

module.exports.init = init;
module.exports.close = close;

module.exports.newTransactionID = newTransactionID;
module.exports.invokeChaincode = invokeChaincode;
module.exports.queryChaincode = queryChaincode;