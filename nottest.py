#!/usr/bin/env python
import time
import requests
import json

# NBCAPID_URL="https://www.ninechain.net/api/v2"
NBCAPID_URL="http://172.18.0.21:8082/v1/test"

def invoke_put_with_meta():
    url = NBCAPID_URL
    params = {
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "args": ["1", "sub", json.dumps({"key":"key2", "value":"value1", "meta":{"readcount":1}})]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "invoke-put-with-meta"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)

def query_history():
    url = NBCAPID_URL
    params = {
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "args": ["1", "sub", "key2"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "query-history"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)

def query_state():
    url = NBCAPID_URL
    params = {
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "args": ["1", "sub","key2"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "query-state"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)

def invoke_inc_readcount():
    url = NBCAPID_URL
    params = {
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "args": ["1", "sub","key2", "5"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "invoke-inc-readcount"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)    

def query_transaction():
    url = NBCAPID_URL
    params = {
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "args": ["1", "1","c63c5528e09cadb8c4e001800ab15f5723b9774f8786b3126f653f733df31c3a", "key2"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "query-transaction"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)


# my_channel_d961824324fb98f7b1b2b8e7278d960f3
if __name__ == "__main__":
    try:
        # invoke_put_with_meta()
        query_history()
        # invoke_inc_readcount()
        # query_state()
        # invoke_put_with_meta()
        # query_transaction()
    except Exception as e:
        print(e)

