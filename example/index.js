'use strict';

var knex = require('./knex-connector').knex
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , Models = require('./bookshelf-models')
  , moment = require('moment')
  , forEachAsync = require('foreachasync').forEachAsync
  , Rrecur = require('rrecur').Rrecur
  , Promise = require('es6-promise').Promise
  , proto
  ;

function logQuery(data) {
  //console.log(data.sql);
  //console.log(data.bindings);
}

function getNext(sched) {
  var rrecur
    , nexttime
    ;

  rrecur = Rrecur.create(sched.get('rules'), new Date(), false);
  // Why is next returning the past?
  nexttime = rrecur.next(false);

  return nexttime;
}

function Rescheduler(Db, opts) {
  opts = opts || {};

  var me = this
    ;

  if (!(me instanceof Rescheduler)) {
    return new Rescheduler(Db, opts);
  }
  EventEmitter.call(me);

  me._timers = {};
  me._opts = opts;
  // TODO check every 14 minutes for the next 15 minutes
  me._opts.interval = me._opts.interval || 10 * 1000; // 15 * 60 * 1000;
  me._opts.window = me._opts.window || 24 * 60 * 60 * 1000;
  me._Models = Db;

  me._meta = me._Models.Meta.forge({ id: 'meta' }).fetch();

  setInterval(function () {
    me._load();
  }, this._opts.interval);
  me._load();
}
util.inherits(Rescheduler, EventEmitter);
Rescheduler.create = Rescheduler;

proto = Rescheduler.prototype;

proto._load = function () {
  var me = this
    , now = Date.now() // lastrun
    , then = now + me._opts.interval + (5 * 60 * 60 * 1000)
    //, triggerTime = moment().utc().startOf('day').hours(22).valueOf()
    , triggerTime = moment().utc().startOf('day').hours(18).minutes(30).valueOf()
    ;

  function loadWindow(meta) {
    // time for the big load
    console.info("[load] cycle is up. Reloading from db");
    console.info("[load] getting everything with a 'next' before");
    console.info("[load]", new Date(then).toISOString());
    console.info("[load]", new Date(then).toString());
    console.info("[load] or where next is null", "\n");

    me._Models.Schedules
      .query(function (qb) {
        qb
          .where('next', '<', new Date(then).toISOString())
          .orWhere('next', null)
          ;
          //.andWhere('next', '>=', meta.get('lastload'))
      })
      .fetchAll({ withRelated: ['appointments'] }).then(function (_schedules) {
        var schedules = _schedules.map(function (s) { return s; })
          ;

        console.log('[upcoming]');
        console.log(schedules);

        return forEachAsync(schedules, function (next, schedule) {
          var appts = schedule.related('appointments').map(function (a) { return a; })
            ;

          if (!appts.length) {
            console.log('[load] NO APPOINTMENTS. Creating...');
            me._createAppointments(schedule).then(next);
          } else {
            console.log('[load] Has appointments.');
            forEachAsync(appts, function (n2, appt) {
            //appts.forEach(function (appt) {
              // although appt.related('schedule') returns a blank object,
              // it gets loaded again before the schedule is needed
              //appt.relations.schedule = schedule;
              appt.related('schedule').set(schedule.attributes);
              //me._loadAppointmentIntoMemory(appt);
            //});
              me._loadAppointmentIntoMemory(appt, schedule).then(n2);
            });
          }
          next();
        });
        /*
        .then(function () {
          return;
          loadAppointments(meta);
        });
        */
      }
    );
  }

  function loadAppointments(meta) {
    me._Models.Appointments.where('next', '<', new Date(then).toISOString()) //.andWhere('next', '>=', meta.get('lastload'))
      .fetchAll({ withRelated: ['schedule'] }).then(function (_appointments) {
        var appts = _appointments.map(function (a) { return a; })
          ;

        return forEachAsync(appts, function (n2, appt) {
          me._loadAppointmentIntoMemory(appt).then(n2);
        });
      }
    );

    // check for events that will fire before the next interval and load them into memory,
    // unless they're already in memory and haven't finished yet
    // TODO load current into memory
    meta.set('lastload', now);
    return meta.save();
  }

  me._meta.then(function (meta) {
    loadWindow(meta);
    return;

    // if we'll hit 10pm UTC before the next interval, reload the window
    if (meta.get('lastload') <= triggerTime && then > triggerTime) {
      loadWindow(meta);
    } else {
      loadAppointments(meta);
    }
  });
};
proto._createAppointments = function (schedule, appt) {
  var me = this
    , json = schedule.toJSON()
    , rrecur
    , nexttime
    ;

  rrecur = Rrecur.create(json.rules, new Date(), false);
  nexttime = rrecur.next(true);

  if (!nexttime) {
    console.error('[appt][create] nothing next', schedule.id);
    return me.unschedule(schedule.id/*, schedule*/);
  }

  appt = appt || me._Models.Appointments.forge();
  console.log('[appt] setting next to', nexttime);
  appt.set('next', nexttime && new Date(nexttime).toISOString());
  appt.set('until', json.until && new Date(json.until).toISOString());
  appt.set('scheduleId', schedule.id);
  //appt.attach(schedule);

  return appt.save().then(function () {
    if ((Date.now() - new Date(nexttime).valueOf()) < me._opts.interval) {
      console.log('[appt] saved');
      me._loadAppointmentIntoMemory(appt, schedule); // schedule.get('next')
    }

    return null;
  });
};
proto._getDoneCb = function (appt, schedule, nexttime) {
  var me = this
    ;

  function doneCb() {
    var lasttime = appt.get('next')
      ;

    delete me._timers[appt.get('id')];
    schedule.set('previous', appt.get('next') && new Date(appt.get('next')).toISOString());

    if (nexttime) {
      // TODO could maybe keep appt history, but recycling instead for now
      appt.set('next', nexttime && new Date(nexttime).toISOString());
      // TODO some time delta appt.set('until', );
      return appt.save().then(function () {
        console.log('[done] setting up for next time');
        console.log('[done]', lasttime);
        console.log('[done]', nexttime);
        schedule.set('next', new Date(nexttime).toISOString());
        return schedule.save();
      });
    } else {
      return appt.destroy().then(function () {
        schedule.set('next', null);
        return me.unschedule(schedule.id, schedule);
      });
    }
  }

  return doneCb;
};
proto._loadForRealz = function (apptId, timeout) {
  var me = this
    ;

  me._timers[apptId] = true; 

  console.log('[ready]', 'will fire event in', timeout + 'ms');
  setTimeout(function () {
    console.log('[aim]');
    me._Models.Appointments.forge({ id: apptId }).fetch({ withRelated: ['schedule'] }).then(function (appt2) {
      console.log("[fire]");
      var schedule = appt2.related('schedule')
        , nexttime = getNext(schedule)
        , details = { appointment: appt2.toJSON(), next: nexttime, previous: appt2.get('next') }
        , event = appt2.related('schedule').get('event')
        ;

      me.emit('appointment', event, details, me._getDoneCb(appt2, schedule, nexttime));
    });
  }, timeout);

  // this should not return a promise, it is synchronous
  // but the callback could return a promise so the user knows it's deleted
  return null;
};
proto._loadAppointmentIntoMemory = function (appt, _schedule) {
  console.log('[test] load (if ready) or remove (if stale) or let sit');
  var me = this
    , schedule = _schedule || appt.related('schedule')
    , nexttime = getNext(schedule)
    ;

  return new Promise(function (resolve, reject) {
    var now = Date.now()
      , timeout = new Date(appt.get('next')).valueOf() - now
      , until
      ;

    // If it's already in the queue, don't worry about it
    if (me._timers[appt.get('id')]) {
      console.log('[loaded] this event is already loaded and waiting to fire');
      resolve();
      return;
    }

    // If there are no more, destroy it
    if (!appt.get('next')) {
      console.info("[complete] there is no next event for this schedule");
      console.info(appt.toJSON());
      return me._getDoneCb(appt, schedule, nexttime)().then(resolve, reject);
    }

    // If it's past due, then just destroy it
    until = new Date(appt.get('until'));
    if (now > until.valueOf()) {
      console.warn("[stale] did not fire by", until.toString());
      console.warn(appt.toJSON());
      return me._getDoneCb(appt, schedule, nexttime)().then(resolve, reject);
    }

    // If it's coming up soon, then load it into memory
    timeout = new Date(appt.get('next')).valueOf() - now;
    if (timeout < me._opts.interval) {
      console.info("[hot] this will be ready to load soon");
      me._loadForRealz(appt.id, timeout);
    } else {
      console.warn(
        "[cold] this event won't be ready for a while ("
      + timeout / (60 * 60 * 1000)
      + " hours)"
      );
      console.warn("[TODO] double check that cold events aren't due to db error");
    }

    resolve();
    return;
  });
};
proto.schedule = function (event, rules, opts) {
  opts = opts || {};
  var me = this
    , schedule
    , leaway = (72 * 60 * 60 * 1000)
    , rrecur
    ;

  rrecur = Rrecur.create(rules, new Date());
  /*
  var i
    ;
  rrecur = Rrecur.create(rules, new Date());
  console.log('CREATING SCHEDULE');
  i = 0;
  while (i < 10) {
    i += 1;
    console.log(rrecur.next());
  }

  rrecur = Rrecur.create(rules, new Date(Date.now() + (48 * 60 * 60 * 1000)));
  console.log('CREATING SCHEDULE');
  i = 0;
  while (i < 10) {
    i += 1;
    console.log(rrecur.next());
  }
  */

  if (!rules.rrule) {
    rules.rrule = {
      until: new Date(new Date(rules.dtstart.utc).valueOf() + leaway).toISOString()
    , count: 1
    , freq: 'yearly'
    };
  }

  schedule = {
    event: event
  , dtstart: rules.dtstart.utc
  , rules: rules
  //, dtstart: rules.dtstart
  , rrule: Rrecur.stringify(rules.rrule)
  , dummy: true
  };

  if ((Date.now() - new Date(rules.dtstart.utc).valueOf()) < me._opts.interval) {
    // load to appointments (and memory)
    schedule.previous = null;
    schedule.next = new Date(rules.dtstart.utc).toISOString();
    schedule.until = new Date(new Date().valueOf() + (opts.timeout || leaway)).toISOString();
    schedule.timeout = opts.timeout;
  }

  return me._Models.Schedules.forge().on('query', logQuery).save(schedule).then(function (record) {
    return me._createAppointments(record).then(function () {
      return record;
    });
  });
};
/*
proto.pause = function (id) {
  return this._Models.Schedules.forge({ id: id }).fetch().then(function (schedule) {
    return schedule.set('next', null).save();
  });
};
proto.resume = function (id) {
  return this._Models.Schedules.forge({ id: id }).fetch().then(function (schedule) {
    return schedule.set('next', getNext(schedule)).save();
  });
};
*/
proto.unschedule = function (id, schedule) {
  var me = this
    ;

  function destroy(schedule) {
    var scheduleObj = schedule.toJSON()
      ;

    return schedule.destroy().then(function () {
      me.emit('unschedule', scheduleObj);
      return scheduleObj;
    });
  }

  if (schedule) {
    return destroy(schedule);
  }

  return this._Models.Schedules.forge({ id: id }).on('query', logQuery).fetch().then(function (schedule) {
    return destroy(schedule);
  });
};
/*
proto.postpone = function (id, date) {
  return this._Models.Schedules.forge({ id: id }).fetch().then(function (schedule) {
    return schedule.set('postpone', date).save();
  });
};
*/

module.exports.create = function () {
  return Models.create(knex).then(function (Db) {
    return Rescheduler.create(Db, {});
  });
};
