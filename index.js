'use strict';

var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , Models = require('./lib/bookshelf-models')
  , moment = require('moment')
  , forEachAsync = require('foreachasync').forEachAsync
  , Rrecur = require('rrecur').Rrecur
  , Promise = require('es6-promise').Promise
  , UUID = require('node-uuid')
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
  me._opts.interval = me._opts.interval || 7 * 60 * 1000; // 15 * 60 * 1000;
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

        return forEachAsync(schedules, function (next, schedule) {
          var appts = schedule.related('appointments').map(function (a) { return a; })
            ;

          if (!appts.length) {
            me._createAppointments(schedule).then(next);
          } else {
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
  appt.set('next', nexttime && new Date(nexttime).toISOString());
  appt.set('until', json.until && new Date(json.until).toISOString());
  appt.set('scheduleId', schedule.id);
  appt.set('errorCount', 0); // xattrs hack
  appt.set('dummy', true); // xattrs hack
  //appt.attach(schedule);

  return appt.save().then(function () {
    if ((Date.now() - new Date(nexttime).valueOf()) < me._opts.interval) {
      me._loadAppointmentIntoMemory(appt, schedule); // schedule.get('next')
    }

    return null;
  });
};
proto._getDoneCb = function (appt, schedule, nexttime) {
  var me = this
    ;

  function doneCb(opts) {
    // TODO add another status callback

    delete me._timers[appt.get('id')];
    opts = opts || {};

    var lasttime = appt.get('next')
      , isoNexttime
      ;

    if (opts.error) {
      // try again in a little bit
      appt.set('errorCount', (parseInt(appt.get('errorCount'), 10) || 0) + 1);
      // TODO intervals 5, 15, 30, 60, etc
      opts.snooze = Math.pow(2, appt.get('errorCount') - 1) * (15 * 60 * 1000);
    } else {
      appt.set('errorCount', 0);
    }

    opts.snooze = parseInt(opts.snooze, 10) || 0;

    if (opts.snooze > 0) {
      opts.reschedule = Date.now() + opts.snooze;
      // there not a next event in the schedule, or that next event is further away
      if (!nexttime || opts.reschedule < new Date(nexttime).valueOf()) {
        isoNexttime = nexttime = new Date(opts.reschedule).toISOString();
      }
    } else {
      schedule.set('previous', appt.get('next') && new Date(appt.get('next')).toISOString());
    }

    isoNexttime = isoNexttime || (nexttime && new Date(nexttime).toISOString());

    if (isoNexttime) {
      // TODO could maybe keep appt history, but recycling instead for now
      appt.set('next', isoNexttime);
      // TODO some time delta appt.set('until', );
      return appt.save().then(function () {
        schedule.set('next', isoNexttime);
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

  setTimeout(function () {
    me._Models.Appointments.forge({ id: apptId }).fetch({ withRelated: ['schedule'] }).then(function (appt2) {
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
      resolve();
      return;
    }

    // If there are no more, destroy it
    if (!appt.get('next')) {
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
      me._loadForRealz(appt.id, timeout);
    } else {
      console.warn(
        "[WARN] this event won't be ready for a while ("
      + timeout / (60 * 60 * 1000)
      + " hours)"
      );
      console.warn("[WARN] double check that cold events aren't due to db error");
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

  if (!rules.rrule) {
    rules.rrule = {
      until: new Date(new Date(rules.dtstart.utc).valueOf() + leaway).toISOString()
    , count: 1
    , freq: 'yearly'
    };
  }

  schedule = {
    event: event
  , uuid: UUID.v4()
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
      return { id: record.id, uuid: record.get('uuid'), next: record.get('next') };
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
    , fields = {}
    ;

  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    fields.uuid = id;
  } else {
    fields.id = id;
  }

  function destroy(schedule) {
    var scheduleObj = schedule.toJSON()
      ;

    // TODO
    // https://github.com/tgriesser/bookshelf/issues/135
    return schedule.related('appointments').invokeThen('destroy').then(function () {
      return schedule.destroy().then(function () {
        me.emit('unschedule', scheduleObj);
        return scheduleObj;
      });
    });
  }

  if (schedule) {
    return destroy(schedule);
  }

  return this._Models.Schedules.forge(fields).on('query', logQuery)
    .fetch({ withRelated: 'appointments' })
    .then(function (schedule) {
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

module.exports.create = function (opts) {
  opts = opts || {};

  var knex = opts.knex
    ;

  if (!knex) {
    knex = require('./lib/knex-connector').create(opts.filename);
  }

  return Models.create(knex).then(function (Db) {
    return Rescheduler.create(Db, opts);
  });
};
