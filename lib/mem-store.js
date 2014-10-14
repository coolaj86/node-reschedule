'use strict';

var _ = require('lodash')
  , Rrule = require('rrule').RRule
  ;

module.exports = function() {
  var memory = {}
    ;

  console.warn('reschedule: using an in-memory store for default store implementation');

  return {
    between: function(start, stop, cb) {
      var events = _.flatten(_.map(memory, function(event) {
        var n;
        if ((n = Rrule.fromString(event.rrule).between(start, stop)).length) {
          return n.map(function(time) {
            return {time: new Date(time), data: event.data};
          });
        } else {
          return [];
        };
      }), true);

      setTimeout(function() {
        cb(null, events);
      }, 0);
    },

    set: function(data, cb) {
      memory[data.uuid] = data;

      if (typeof cb === 'function') {
        setTimeout(cb, 0);
      }
    },

    destroy: function(id, cb) {
      memory[id] = undefined;
      memory = _.compact(memory);

      if (typeof cb === 'function') {
        cb();
      }
    }
  };
};
