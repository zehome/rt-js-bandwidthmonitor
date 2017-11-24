This project is a little bit analog to etherape.

The goal is to show traffic generated on a Linux machine in your web browser.

It can helps to determine who is burning the bandwidth in real time.

Screenshot: https://lh4.googleusercontent.com/-P7cBhztzBbg/TiMW-ZVf1fI/AAAAAAAAAnU/c16cU1YBnjw/s800/screenshot_rt-js-bandwidthmonitor.jpeg

I shot a quick video to introduce this project: http://www.youtube.com/watch?v=1oZB5vvQ4Es

**UPDATE 2017/11**: This project was using obsolete websocket draft. I just updated the websocket server/client to use modern technologies.

Uggly start
===========
```
apt install libpcap-dev
virtualenv venv
. venv/bin/activate
pip -p python2 install pypcap dpkt websocket-client autobahn trollius
python wschatserver.py &
(cd www && python -m SimpleHTTPServer 7000 >/dev/null 2>&1&)
sudo ./venv/bin/python node.py -i eth0 -u $USER -g $USER

firefox http://localhost:7000/
```
