#!/usr/bin/env python
import time
import requests
import json

# NBCAPID_URL="https://www.ninechain.net/api/v2"
NBCAPID_URL="http://172.18.0.12:8082/sdk/v2"

line = 0 
def query_data():
    url = NBCAPID_URL

    # line = ""
    # with open("/proc/uptime") as fp:
    #     line = fp.readline()
    global line 
    line = line + 1
    params = {
        "id": "{}".format(line),
        "ext": "userdata",
        "channel": "businesschannel",
        "contract":"notaryinfo",
        "method": "query-state",
        "subch":"1",
        "args": ["key2"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "push"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(line, s)

def invoke_put_with_meta():
    url = NBCAPID_URL
    global line 
    line = line + 1

    params = {
        "id": "{}".format(line),
        "ext": "userdata",
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "subch":"vvtrip",
        "rid": "xxx",
        "method": "invoke-put-with-meta",
        "args": [json.dumps({"key":"mykey1", "value":"value1", "meta":{"readcount":1}})]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "push"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)

def query_transactions():
    url = NBCAPID_URL

    global line 
    line = line + 1
    params = {
        "id": "{}".format(line),
        "ext": "userdata",
        "channel": "businesschannel",
        "contract":"notaryinfo",
        "method": "query-history",
        "subch":"1",
        "args": ["key2"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "push"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(line, s)

def query_transaction():
    url = NBCAPID_URL

    global line 
    line = line + 1
    params = {
        "id": "{}".format(line),
        "ext": "userdata",
        "channel": "businesschannel",
        "contract":"notaryinfo",
        "method": "query-transaction",
        "subch":"1",
        "args": ["key2"]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "push"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(line, s)

def poll():
    url = NBCAPID_URL
    params = {"max": 1, "timeout":1}

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "pull"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    print(s)


# my_channel_d961824324fb98f7b1b2b8e7278d960f3
if __name__ == "__main__":
    try:
        # while True:
        #     query()
            # time.sleep(0.2)
        # poll()
        # invoke_put_with_meta()
        #query_transactions()
        query_transaction()
    except Exception as e:
        print(e)

