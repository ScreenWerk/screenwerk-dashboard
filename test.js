const fs = require('fs')
const util = require('util')
const Tail = require('always-tail')
const http = require('http')

const NGINX_LOG = process.env.NGINX_LOG
if (!fs.existsSync(NGINX_LOG)) fs.writeFileSync(NGINX_LOG, "")


var server = http.createServer(function(req, res) {
  res.writeHead(200, { 'content-type' : 'text-plain' })
  res.write('Hello\n')

  var tail = new Tail(NGINX_LOG, '\n', { interval: 100 })
  tail.on('line', function(line) {
    res.write(line + '\n')
  })

})
server.listen(3000)
