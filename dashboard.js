const fs = require('fs')
const util = require('util')
const Tail = require('always-tail')

const entu = require('entulib')
const APP_ENTU_OPTIONS = {
  entuUrl: process.env.ENTU_URL || 'https://piletilevi.entu.ee',
  user: process.env.ENTU_USER || 1000,
  key: process.env.ENTU_KEY || ''
}


const NGINX_LOG = __dirname + '/' + process.env.NGINX_LOG

var screens = {}
var screenGroups = {}
if (!fs.existsSync(NGINX_LOG)) fs.writeFileSync(NGINX_LOG, "")
console.log('Tailing logfile from: ' + NGINX_LOG)
var tail = new Tail(NGINX_LOG, '\n', { interval: 100 })

let re = /\b((?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\b.*\[(.*)\].*"GET (.*?)\/([0-9]*)(?:\.json)? HTTP.*?" ([0-9]+?) .*" "(.*)"/
tail.on('line', function(line) {
  let match = re.exec(line)

  if (match === null) {
    console.log('cant parse ', line)
    return
  }
  let screenEid = match[4]
  let ip = match[1]
  let id = screenEid + '@' + ip
  let d1 = match[2].split(' ')
  let zone = d1[1]
  let d2 = d1[0].split(':')
  let time = [d2[1], d2[2], d2[3]].join(':')
  let d3 = d2[0].split('/')
  let date = new Date([d3[2], d3[1], d3[0], time, zone].join(' ')).getTime()
  let response_code = match[5]

  if (response_code !== '200') {
    if (screens[id] === undefined) {
      return
    }
  }

  if (screens[id] === undefined) {
    screens[id] = {eid:'', name:'', times:[], path:'', response:'', version:''}
    entu.getEntity(screenEid, APP_ENTU_OPTIONS)
      .then(function(opScreen) {
        let screengroup = opScreen.get(['properties', 'screen-group', 0])
        screens[id].name = opScreen.get(['properties', 'name', 0, 'value'])
        if (screenGroups[String(screengroup.reference)] === undefined) {
          screenGroups[String(screengroup.reference)] = {
            sg: screengroup,
            eid: String(screengroup.reference),
            name: screengroup.value,
            screens: []
          }
        }
        screenGroups[String(screengroup.reference)].screens.push(screens[id])
      })
  }

  screens[id].eid = screenEid
  screens[id].ip = ip
  screens[id].times.push(date)
  screens[id].path = match[3]
  screens[id].response = response_code
  screens[id].version = match[6].split(' ')[match[6].split(' ').length - 1]
  screens[id].lastSeen = screens[id].times[screens[id].times.length - 1]
  if (screens[id].times.length > 1) {
    while (screens[id].times.length > 30) {
      screens[id].times.shift()
    }
    screens[id].avgInterval = Math.round((date - screens[id].times[0]) / 10 / (screens[id].times.length - 1)) / 100
  }
})

tail.on('error', function(data) {
  console.log("error:", data)
})

tail.watch()


const pug = require('pug')
const renderer = pug.compileFile(__dirname + '/dashboard.pug')


const Rx = require('rx')
const requests_ = new Rx.Subject()

function serveStarts(e) {
  // console.log('serving stats')
  e.res.writeHead(200, { 'Content-Type': 'text/HTML' })
  let now = new Date().getTime()
  let i = 1
  e.res.end(renderer({screenGroups: screenGroups}))
}

const subscription = requests_
  // .tap(e => console.log('request to', e.req.url))
  .subscribe(
    serveStarts,
    console.error,
    () => {
        console.log('stream is done')
        // nicely frees the stream
        subscription.dispose()
    }
  )
process.on('exit', () => subscription.dispose())


const http = require('http')
const PORT = process.env.PORT
http.createServer((req, res) => {
  requests_.onNext({ req: req, res: res })
}).listen(PORT, () => {
  console.log(`Server running at port:${PORT}`)
})
