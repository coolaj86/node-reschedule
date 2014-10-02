'use strict';

var _ = require('lodash')
  ;

module.exports = function() {
  var memory = {}
    ;

  console.warn('reschedule: using an in-memory store for default store implementation');

  return {
    get: function(id, cb) {
      if (memory[id] == null) {
        setTimeout(function() {
          cb(new Error('event "' + id + '" does not exist'));
        }, 0);
      } else {
        setTimeout(function() {
          cb(null, memory[id]);
        }, 0);
      }
    },

    findAllWhereDateLessThan: function(time, cb) {
      var events = _.filter(memory, function(event) {
        return event.date < time;
      });

      setTimeout(function() {
        cb(null, events);
      }, 0);
    },

    set: function(id, data, cb) {
      memory[id] = data;
      memory[id].id = id;

      setTimeout(cb, 0);
    },

    destroy: function(id, cb) {
      memory[id] = undefined;

      setTimeout(cb, 0);
    }
  };
};
