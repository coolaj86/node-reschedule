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

Triple Buffer
-------------

* Permanent: All recurring events and events that will not take place by 11:59pm today
* Temporary: All events happening by 11:59pm UTC today (and tomorrow)
  * At 10:00pm UTC all events for the following day will be queued up
* In-memory: Events that will happen within the next 15 minutes

When an event is handled it may be removed from permanent.

One-time Events
===============

* `create(store, opts)`
  * `store` is a storage container with `each()`, `get()`, `set()`, and `save()`
  * `opts.preserveAll` if an event doesn't fire before the next occurence it would generally be skipped. This option ensures that the event fires as many times as it is in the queue.

`.on(eventHandler)`

  * `eventHandler` a callback such as `function (event, done) {}`
    * `done` is a callback that will mark the event as complete.
      * You may return an ES6 Promise in place of calling `done`.

`.once(event, [dtstart], [until])`

  * `event`: A JSON object of your own make.
  * `dtstart`: A UTC timestamp describing when this event should be fired. Defaults to `Date.now()`.
  * `until`: If the system is unable to fire the event by `until`, it will not be fired at all. Defaults to 72 hours from `Date.now()`

`.recurring(event, rrule, [dtstart])`

  * `event`: A JSON object of your own make.
  * `rrule`: either a JSON object or RFC RRULE string.
  * `dtstart`: A UTC timestamp describing when this schedule should begin. Defaults to `Date.now()`.
    * NOTE: For biweekly weekly schedules and such you should specify DTSTART to be the first occurrence of your schedule, not today's date. Otherwise you may get events on the opposite day from what you expect.
