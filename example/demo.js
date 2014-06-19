'use strict';

var reschedule = require('./index')
  ;

reschedule.create().then(function (Reschedule) {
  Reschedule.on('appointment', function (event, appt, done) {
    console.log('event');
    console.log(event);
    console.log('appt.toJSON()');
    console.log(appt.toJSON());
    done();
  });

  Reschedule.schedule(
    { type: "log" }
  , Date.now() + (2 * 60 * 1000)
  , { until: Date.now() + (5 * 60 * 1000) }
  ).then(function () {
    console.log('Created a schedule');
  });
});
