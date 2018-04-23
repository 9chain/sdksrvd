
const path = require('path');
const fs = require('fs');
const util = require('util');
const os = require('os');

const utils = require('fabric-client/lib/utils.js');
const copService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
const CryptoSuite = require('fabric-client/lib/impl/CryptoSuite_ECDSA_AES.js');
const KeyStore = require('fabric-client/lib/impl/CryptoKeyStore.js');
const ecdsaKey = require('fabric-client/lib/impl/ecdsa/key.js');
const BlockDecoder = require('fabric-client/lib/BlockDecoder.js');
const User = require('fabric-client/lib/User.js');

const logger = require("winston")
const { SDKError } = require("./exception")
const { FabricCfg } = require("./config")

const Client = require('fabric-client');
Client.addConfigFile('config.json');
Client.setConfigSetting('request-timeout', 60000);
ORGS = Client.getConfigSetting('test-network');

// directory for file based KeyValueStore
const KVS = path.join(os.tmpdir(), 'hfc', 'hfc-kvs');

const tlsOptions = {
    trustedRoots: [],
    verify: false
};

class Sdk {
    constructor() {
        this.client = new Client()
        this.channelMap = new Map()
        this.peerMap = new Map()
    }

    storePathForOrg(org) {
        return KVS + '_' + org;
    };

    getChannel(channel) {
        channel = channel || FabricCfg.DefaultChannel
        return this.channelMap.get(channel).channel
    }

    getEventHubs(channel) {
        channel = channel || FabricCfg.DefaultChannel
        return this.channelMap.get(channel).eventhubs
    }

    async getMember(username, password, userOrg) {
        const caUrl = ORGS[userOrg].ca.url;

        const user = await this.client.getUserContext(username, true)
        if (user && user.isEnrolled()) {
            logger.debug('Successfully loaded member from persistence')
            return user
        }

        const member = new User(username);
        let cryptoSuite = this.client.getCryptoSuite();
        if (!cryptoSuite) {
            cryptoSuite = Client.newCryptoSuite();
            if (userOrg) {
                cryptoSuite.setCryptoKeyStore(Client.newCryptoKeyStore({ path: this.storePathForOrg(ORGS[userOrg].name) }));
                this.client.setCryptoSuite(cryptoSuite);
            }
        }
        member.setCryptoSuite(cryptoSuite);
        const cop = new copService(caUrl, tlsOptions, ORGS[userOrg].ca.name, cryptoSuite);
        const enrollment = await cop.enroll({enrollmentID: username, enrollmentSecret: password})
        await member.setEnrollment(enrollment.key, enrollment.certificate, ORGS[userOrg].mspid)
        let skipPersistence = false
        if (!this.client.getStateStore()) {
            skipPersistence = true;
        }
        await this.client.setUserContext(member, skipPersistence);
        return member
    }
    
    async initChannel(channel, userOrg) {
        this.channelMap.set(channel, {channel: this.client.newChannel(channel),eventhubs: []})

        var caRootsPath = ORGS.orderer.tls_cacerts
        let caData = fs.readFileSync(caRootsPath)
        let caroots = Buffer.from(caData).toString()

        const newOrder = this.client.newOrderer(ORGS.orderer.url,
            {
                'pem': caroots,
                'ssl-target-name-override': ORGS.orderer['server-hostname']
            }
        )

        const chn = this.getChannel(channel)
        chn.addOrderer(newOrder)
        
        const admin = await this.getMember('admin', 'adminpw', userOrg)

        // set up the channel to use each org's 'peer1' for
        // both requests and events
        for (let key in ORGS) {
            if (ORGS.hasOwnProperty(key) && typeof ORGS[key].peer1 !== 'undefined') {
                let data = fs.readFileSync(ORGS[key].peer1['tls_cacerts'])
                let peer = this.client.newPeer(ORGS[key].peer1.requests, {
                        pem: Buffer.from(data).toString(),
                        'ssl-target-name-override': ORGS[key].peer1['server-hostname']
                    }
                )
                chn.addPeer(peer)
                this.peerMap.set(key, peer)
            }
        }

        // an event listener can only register with a peer in its own org
        let data = fs.readFileSync(ORGS[userOrg].peer1['tls_cacerts'])
        let eh = this.client.newEventHub()
        eh.setPeerAddr(ORGS[userOrg].peer1.events, {
                pem: Buffer.from(data).toString(),
                'ssl-target-name-override': ORGS[userOrg].peer1['server-hostname'],
                'grpc.http2.keepalive_time': 15
            }
        )

        eh.connect()
        this.getEventHubs(channel).push(eh)
        return chn.initialize()
    }

    getOnePeer() {
        for (let [k, v] of this.peerMap) {
            return v 
        }
    }

    closeChannel(channel) {
        const c = this.getChannel(channel)
        let peers = c.getPeers()
        for (let i in peers) {
            let peer = peers[i]
            peer.close()
        }

        let orderers = c.getOrderers()
        for (let i in orderers) {
            let orderer = orderers[i]
            orderer.close()
        }

        const eventhubs = this.getEventHubs(channel)
        for (let key in eventhubs) {
            const eventhub = eventhubs[key]
            if (eventhub && eventhub.isconnected()) {
                logger.debug('Disconnecting the event hub')
                eventhub.disconnect() //this will also close the connection
            }
        }
    }

    close() {
        // all done, shutdown connections on all
        for (let key in this.channelMap) {
            this.closeChannel(key)
        }
    }

    newTransactionID() {
        return this.client.newTransactionID()
    }

    async queryTransaction(channel, request) {
        const {chaincodeId, fcn, args} = request
        // ["1", "sub","b4dbc6c26c18503d5fb87a3bdd6d08bd195bf44b8d1b93368a261058bc85459a", "key2"]
        const subChannel = args[1]
        const txId = args[2]
        const key = args[3]
        
        const chn = this.getChannel(channel)

        try {
            const processTrans = await chn.queryTransaction(txId)
            const header = processTrans['transactionEnvelope']['payload']['header']
            const data = processTrans['transactionEnvelope']['payload']['data']

            const writes = data.actions[0].payload.action.proposal_response_payload.extension.results.ns_rwset[1].rwset.writes
       
            const result = []

            if (writes) {
                for (let write of writes) {
                    const fullKey = write.key
                    const pos = fullKey.indexOf(subChannel);
                    if (pos >= 0) {
                        write.key = fullKey.substr(subChannel.length)
                    }

                    if (!key || key === write.key) {
                        result.push({ write })
                    }
                }
            }
            let timestamp = Date.parse(new Date(header.channel_header.timestamp));
            timestamp = timestamp/1000;

            return {
                'tx_id': header.channel_header.tx_id,
                'timestamp': timestamp,
                'type': BlockDecoder.HeaderType.convertToString(header.channel_header.type),
                'data': result
            }
        } catch(err) {
            logger.error('QueryTransaction fail:' + err.stack ? err.stack : err)

            const {code, details} = err
            if (code && details) {
                throw new SDKError('undefine', 'QueryTransaction fail:' + details)
            }

 
            throw new SDKError('undefine', 'QueryTransaction fail:' + err.message)
        }
    }

    async queryChaincode(channel, reqParam) {
        const chn = this.getChannel(channel)
        const response_payloads = await chn.queryByChaincode(reqParam)
        if (response_payloads && response_payloads.length > 0) {
            const resp = response_payloads[0]
            if (resp["details"]) {
                throw new SDKError('undefine', resp["details"])
            }

            return resp.toString('utf8')
        } else {
            logger.error('response_payloads is null');
            throw new SDKError('undefine', 'Failed to get response on query');
        }
    }
    
    async invokeChaincode(rid, channel, reqParam) {
        const tx_id = reqParam.txId

        const chn = this.getChannel(channel)
        const results = await chn.sendTransactionProposal(reqParam)
        const proposalResponses = results[0]
        const proposal = results[1]
        const all_good = true

        for (let r of proposalResponses) { 
            if (!(r.response && r.response.status === 200)) {
                const details = r["details"]
                throw new SDKError(rid, 'Proposal error: ' + details)
            }
        }

        if (!await chn.compareProposalResponseResults(proposalResponses)) {
            const msg = 'Not all proposals matching read/write sets'
            logger.error(msg)
            throw new SDKError(rid, 'Proposal error: ' + msg)
        }

        const request = {proposal, proposalResponses}

        const deployId = tx_id.getTransactionID()
        let eventPromises = []

        const eventhubs = this.getEventHubs(channel)
        eventhubs.forEach((eh) => {
            let txPromise = new Promise((resolve, reject) => {
                const id = deployId.toString()
                let timer = setTimeout(() => {
                    eh.unregisterTxEvent(id)
                    reject("Timeout to recv event")
                }, 600 * 1000)

                eh.registerTxEvent(id, (tx, code) => {
                        clearTimeout(timer)
                        eh.unregisterTxEvent(id)

                        if (code !== 'VALID') {
                            return reject("Event was not VALID: " + id)
                        }
                        
                        resolve()
                    }, err => {
                        eh.unregisterTxEvent(id)
                        clearTimeout(timer)
                        
                        logger.error('on tx event error. but regard as success', id, err.message)
                        const msg = "Event error: " + err.message
                        reject(msg)
                    }
                )
            })

            eventPromises.push(txPromise)
        })

        const sendPromise = chn.sendTransaction(request)
        try {
            const res = await Promise.all([sendPromise].concat(eventPromises))
            const r = res[0]
            return { 'rid': rid, 'info': r["info"], "status":r["status"], 'txId': deployId }
        }catch(e) {
            log.error("sendTransaction fail " + e.message)
            throw new SDKError(rid, 'sendTransaction fail: ' + e.message);
        }
    }
}

module.exports = { Sdk }