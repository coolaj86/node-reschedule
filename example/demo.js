'use strict';

var reschedule = require('../index')
  , path = require('path')
  , opts = { filename: path.join(__dirname, "reschedule.sqlite3") }
  ;

reschedule.create(opts).then(function (Reschedule) {
  Reschedule.on('appointment', function (event, appt, done) {
    console.log('appointment');
    console.log('event');
    console.log(event);
    done();
  });

  Reschedule.on('unschedule', function (schedule) {
    console.log('unschedule');
    console.log(schedule);
  });

  var event = { type: "log" }
    , rules
    , zoneless
    , opts
    ;
    
  console.log('zoneless');
  console.log(zoneless);
  rules = {
    dtstart: {
      utc: new Date(Date.now() + (5 * 1000))
    , locale: 'GMT-0600 (PDT)'
    }
  , rrule: {
      freq: "daily"
    , count: 2
    }
  };

  opts = {
    timeout: (5 * 60 * 60 * 1000)
    // TODO staletime
  , until: Date.now() + (7 * 24 * 60 * 60 * 1000)
  };

  Reschedule.schedule(event, rules, opts).then(
    function () {
      console.log('Created a schedule');
      // TODO use hash
    }
  , function (err) {
      console.error('Failed to create a schedule');
      setTimeout(function () {
        console.error(err);
        throw err;
      });
    }
  );
});
