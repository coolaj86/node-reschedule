'use strict';

var memStore = require('./lib/mem-store')
  ,   rrecur = require('rrecur')
  ;

module.exports = function Rescheduler(options) {
  if (!(this instanceof Rescheduler)) {
    return new Rescheduler(options);
  }

  options = options || {};

  if (!options.store) {
    this.store = memStore();
  } else {
    this.store = options.store;
  }

  // default interval: 7 minutes
  if (null == options.interval) {
    this.interval = 7 * 60 * 1000;
  } else {
    this.interval = options.interval;
  }

  // default sampling window: 24 hours
  if (null == options.window) {
    this.window = 24 * 60 * 60 * 1000;
  } else {
    this.window = options.window;
  }

  if (!options.error) {
    this.handleError = function(err) {
      throw err;
    };
  } else {
    this.handleError = options.error;
  }

  this._options = options;
  this._timers = [];

  var self = this;
  this._loadInterval = setInterval(function load() {
    self._load();
  }, options.interval);

  setTimeout(load, 0);
}

Rescheduler.prototype._load = function() {
  var store = this.store
    , error = this.handleError
    , then = Date.now() + this.interval
    , self = this
    ;

  var promise =
      store.findAllWhereDateLessThan(then, function loadEvents(err, events) {
    if (err) {
      error(err);
      return;
    }

    // cancel any buffered events
    for (var i = 0, l = self._timers.length; i < l; i++) {
      clearTimeout(self._timers[i]);
    }

    self._timers = [];

    for (i = 0, l = events.length; i < l; i++) {
      loadForRealz(events[i]);
    }
  });


  if (promise && typeof promise.then === 'function') {
    promise.then(function(events) {
      loadEvents(null, events);
    }).catch(function(err) {
      loadEvents(err);
    });
  }

  function loadForRealz(event) {
    var now = Date.now()
      , timeout = +new Date(event.next) - now
      ;

    self._timers.push(setTimeout(function() {
      var promise = self.store.get(event.id, function emitEvent(err, data) {
        if (err) {
          self.error(err);
          return;
        }

        self.emit(data);
      });

      if (promise && typeof promse.then === 'function') {
        promise.then(function(data) {
          emitEvent(null, data);
        }).catch(function(err) {
          emitEvent(err);
        });
      }
    }, timeout));
  }
};

Rescheduler.prototype.schedule = function(event, rules, options) {
  // TODO
};
