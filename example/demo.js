'use strict';

var reschedule = require('./index')
  ;

reschedule.create().then(function (Reschedule) {
  Reschedule.on('appointment', function (event, appt, done) {
    console.log('event');
    console.log(event);
    done();
  });

  return;
  Reschedule.schedule(
    { type: "log" }
  , Date.now() + (5 * 1000)
  , { timeout: (5 * 60 * 1000)
    //, until: Date.now() + (5 * 60 * 1000)
    , until: Date.now() + (7 * 24 * 60 * 60 * 1000)
    }
  ).then(function () {
    console.log('Created a schedule');
    // TODO use hash
  }, function (err) {
    console.error('Failed to create a schedule');
    console.error(err);
  });
});
