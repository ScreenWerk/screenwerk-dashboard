const fs = require('fs')
const geoip = require('geoip-lite')
const https = require('https')
const moment = require('moment-timezone')
const Tail = require('always-tail')
const util = require('util')

const entu = require('entulib')
const APP_ENTU_OPTIONS = {
  entuUrl: process.env.ENTU_URL || 'https://piletilevi.entu.ee',
  user: process.env.ENTU_USER || 1000,
  key: process.env.ENTU_KEY || ''
}


const NGINX_LOG = __dirname + '/' + process.env.NGINX_LOG
const PUBLISHER_LOG = __dirname + '/' + process.env.PUBLISHER_LOG

const GOOGLE_TIMEZONE_API_KEY = process.env.GOOGLE_TIMEZONE_API_KEY || ''
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || ''

const setTimezone = function(screen, callback) {
  let url = 'https://maps.googleapis.com/maps/api/timezone/json?location=' + screen.geo.ll.join(',') + '&timestamp=1458000000&key=' + GOOGLE_TIMEZONE_API_KEY
  https.get(url, function(res) {
    let body = ''
    res.on('data', function(chunk) { body += chunk })
    res.on('end', function() {
      screen.timeZoneId = JSON.parse(body).timeZoneId
      callback(screen)
    })
  }).on('error', function(e) { console.log("Got an error: ", e) })
}
// const setAddress = function(screen) {
//   let url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + screen.geo.ll.join(',') + '&key=' + GOOGLE_MAPS_API_KEY
//   console.log(url)
//   https.get(url, function(res) {
//     let body = ''
//     res.on('data', function(chunk) { body += chunk })
//     res.on('end', function() { screen.address = JSON.parse(body).results[0].formatted_address })
//   }).on('error', function(e) { console.log("Got an error: ", e) })
// }

const initPublishedScreengroup = function(screenGroupEid, action, timestamp) {
  if (sgIndex[screenGroupEid] === undefined) {
    sgIndex[screenGroupEid] = { timezonedScreengroups: [] }
    sgIndex[screenGroupEid][action] = timestamp
  }
}

const updateFromPublishedJson = function(screen) {
  fs.readFile(screen.eid + '.json', 'utf8', function(err, data) {
    let jsonData = JSON.parse(data)
    console.log(JSON.stringify(data, null, 4))
  })
}

var screens = {}
var tzScreenGroups = {} // indexed by sgId = screenGroupEid + timeZoneId
var sgIndex = {} // indexed by screenGroupEid


// Tail publisher log
//
if (!fs.existsSync(PUBLISHER_LOG)) fs.writeFileSync(PUBLISHER_LOG, "")
console.log('Tailing logfile from: ' + PUBLISHER_LOG)
var tail = new Tail(PUBLISHER_LOG, '\n', { interval: 100 })

let p_re = /\b([0-9]*)\b \b([a-z]*)\b at (.*)/
tail.on('line', function(line) {
  let match = p_re.exec(line)
  console.log('publisher: ', line)
  console.log('match: ', match)
  let screenGroupEid = match[1]
  let action = match[2]
  let timestamp = new Date(match[3]).getTime()

  // If we unfortunately happened to start dashboard while
  // freshly published screengroup is still compiling,
  // we might hit "compiled" before "published".
  // Is there a problem?
  initPublishedScreengroup(screenGroupEid, action, timestamp)

  if (sgIndex[screenGroupEid]) {
    sgIndex[screenGroupEid].timezonedScreengroups.forEach(function(sgId) {
      tzScreenGroups[sgId][action] = timestamp
      tzScreenGroups[sgId][action + 'Local'] = moment(tzScreenGroups[sgId][action]).tz(tzScreenGroups[sgId].timeZoneId).locale('et').format('llll')
    })
  }

})


// Tail Nginx access log
//
if (!fs.existsSync(NGINX_LOG)) fs.writeFileSync(NGINX_LOG, "")
console.log('Tailing logfile from: ' + NGINX_LOG)
var tail = new Tail(NGINX_LOG, '\n', { interval: 100 })

let n_re = /\b((?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\b.*\[(.*)\].*"GET (.*?)\/([0-9]*)(?:\.json)? HTTP.*?" ([0-9]+?) .*" "(.*)"/
tail.on('line', function(line) {
  let match = n_re.exec(line)

  if (match === null) {
    console.log('cant parse ', line)
    return
  }
  // console.log(match)

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
    screens[id].eid = screenEid
    screens[id].ip = ip
    screens[id].geo = geoip.lookup(ip)
    setTimezone(screens[id], function(_screen) {
      entu.getEntity(_screen.eid, APP_ENTU_OPTIONS)
        .then(function(opScreen) {
          if (_screen.eid != opScreen.get(['id'])) {
            console.log(screenEid + '!=' + opScreen.get(['id']))
            throw 'foooo!'
          }
          let screengroup = opScreen.get(['properties', 'screen-group', 0])
          _screen.name = opScreen.get(['properties', 'name', 0, 'value'])
          let screenGroupEid = String(screengroup.reference)
          let sgId = screenGroupEid + '.' + _screen.timeZoneId
          if (tzScreenGroups[sgId] === undefined) {
            tzScreenGroups[sgId] = { eid: screenGroupEid, screens: [], timeZoneId: _screen.timeZoneId }
            entu.getEntity(screenGroupEid, APP_ENTU_OPTIONS)
              .then(function(opScreenGroup) {
                let timestamp = new Date(opScreenGroup.get(['properties', 'published', 0, 'value'])).getTime()
                initPublishedScreengroup(screenGroupEid, 'published', timestamp)
                sgIndex[screenGroupEid].timezonedScreengroups.push(sgId)
                tzScreenGroups[sgId].name = opScreenGroup.get(['displayname'])
                tzScreenGroups[sgId].published = timestamp
                tzScreenGroups[sgId].publishedLocal = moment(tzScreenGroups[sgId].published).tz(tzScreenGroups[sgId].timeZoneId).locale('et').format('llll')
              })
          }
          tzScreenGroups[sgId].screens.push(_screen)
        })
    })
  }

  screens[id].times.push(date)
  screens[id].path = match[3]
  screens[id].response = response_code
  let _versions = match[6].split(' ')[match[6].split(' ').length - 1]
  screens[id].version = { screenwerk: _versions.split(';')[0], electron: _versions.split(';')[1] }
  screens[id].lastSeen = screens[id].times[screens[id].times.length - 1]
  if (screens[id].times.length > 1) {
    while (screens[id].times.length > 30) {
      screens[id].times.shift()
    }
    screens[id].avgInterval = Math.round((date - screens[id].times[0]) / 10 / (screens[id].times.length - 1)) / 100
  }
  updateFromPublishedJson(screens[id])
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
  e.res.end(renderer({screenGroups: tzScreenGroups}))
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
