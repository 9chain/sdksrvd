#!/usr/bin/env python
import time
import requests
import json
import threading

# NBCAPID_URL="https://www.ninechain.net/api/v2"
NBCAPID_URL="http://172.20.0.21:8082/v1/test"

def invoke_put_with_meta(id, i):
    url = NBCAPID_URL
    params = {
        "channel": "businesschannel",
        "contract": "notaryinfo",
        "args": ["1", "sub", json.dumps({"key":"key2", "value":"value1"})]
    }

    jsondata = {"params": params, "jsonrpc": "2.0", "id": 0, "method": "invoke-put-with-meta"}
    res = requests.post(url, json=jsondata, headers={'content-type': 'application/json', 'X-Api-Key': '1234567890'})
    s = res.content.decode()
    if s.find("error") != -1:
        print(id, i, "fail", s)

    return s

def run_thread(id):
    try:
        for i in range(10):
            print(id, i)
            invoke_put_with_meta(id, i)
    except Exception as e:
        print(e)

# my_channel_d961824324fb98f7b1b2b8e7278d960f3
if __name__ == "__main__":
    threads = []
    for i in range(1, 2):
        t = threading.Thread(target=run_thread, args=(i,))
        time.sleep(0.1)
        threads.append(t)
        t.start()

    print("wait")
    for x in threads:
        x.join()
    print("done")

