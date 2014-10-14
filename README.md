node-reschedule
===============

A job / event scheduler for both one-time and recurring (RRULE-based) events

DRAFT / IN PROGRESS
===

* Save the last time period for which the scheduler ran
* Save the next 24 hours of events
* Save the last run to the event
* Get all events from the time of the last run through next 24-hour UTC period
* Fire all events that aren't too late
* Remove expired schedules

Usage
=====

```javascript
var Rrule = require('rrule').RRule;

var scheduler = require('reschedule')({
  store: new myCustomStore(), // uses an in-memory store by default
  interval: 7 * 60 * 1000, // interval in ms to make batch loads for events
});

scheduler.schedule({
  title: 'First Event' // any old JSON data that will be emitted with the event
}, { // this can be any arbitrary options for RRule or just an RRule string
  freq: Rrule.SECONDLY,
  dtstart: new Date()
}, function(err, id) { // promises are supported too, depending on your store.
  if (err) throw err;

  console.log('First Event scheduled');

  var now = Date.now()

  scheduler.on('event', function(time, data) {
    console.log(data.title + ' fired at ' + time);

    if (+time > (now + 5000)) {
      scheduler.unschedule(id);
    }
  });
});
```
