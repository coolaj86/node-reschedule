'use strict';

var  Emitter = require('events').EventEmitter
  , memStore = require('./lib/mem-store')
  ,    Rrule = require('rrule').RRule
  ,     UUID = require('uuid')
  ;

var Rescheduler = module.exports = function(options) {
  if (!(this instanceof Rescheduler)) {
    return new Rescheduler(options);
  }

  options = options || {};

  if (!options.store) {
    this.store = memStore();
  } else {
    this.store = options.store;
  }

  if (null == options.interval) {
    this.interval = 7 * 60 * 1000;
  } else {
    this.interval = options.interval;
  }

  this._options = options;
  this._timers = [];

  this._loadInterval = setInterval(load, options.interval);

  setTimeout(load, 0);

  var self = this;
  function load() {
    self._load();
  }
}

Rescheduler.prototype = Object.create(Emitter.prototype);

// this method needs to be robust.
Rescheduler.prototype._load = function() {
  var  now = new Date()
    , then = new Date(+now + this.interval)
    , self = this
    ;

  var promise = this.store.between(now, then, function getEvents(err, events) {
    if (err) return console.error(err.stack);

    self._timers.forEach(function(timer) {
      clearTimeout(timer);
    });

    self._timers = [];

    events.forEach(function(event) {
      self._timers.push(setTimeout(function() {
        self.emit('event', event.time, event.data);
      }, +event.time - now));
    });
  });

  if (promise && 'function' === typeof promise.then) {
    promise.then(function(schedules) {
      handleSchedules(null, schedules);
    }).error(handleSchedules);
  }
};

Rescheduler.prototype.schedule = function(event, rrule, cb) {
  if ('string' !== typeof rrule) {
    rrule = Rrule.optionsToString(rrule);
  }

  var schedule = {
    data: event,
    rrule: rrule,
    uuid: UUID.v4()
  };

  var self = this;
  var promise = this.store.set(schedule, function(err) {
    if (err) return cb(err);
    cb();

    process.nextTick(function() {
      self._load()
    });
  });

  if (promise && 'function' === typeof promise.then) {
    return promise.tap(function() {
      self._load();
    });
  }
};

Rescheduler.prototype.unschedule = function(id, cb) {
  var self = this;
  var promise = this.store.destroy(id, function(err) {
    if (err) return cb(err);
    cb && cb();

    self._load();
  });

  if (promise && 'function' === typeof promise.then) {
    return promise.tap(function() {
      self._load();
    });
  }
};
