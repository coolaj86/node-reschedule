'use strict';

var knex = require('./knex-connector').knex
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , Models = require('./bookshelf-models')
  , moment = require('moment')
  , forEachAsync = require('foreachasync').forEachAsync
  , Rrecur = require('rrecur').Rrecur
  , Promise = require('es6-promise').Promise
  , p
  ;

function getNext(sched) {
  var rrule
    , rrecur
    ;

  rrule = Rrecur.parse(sched.get('rrule'));
  rrule.dtstart = sched.get('dtstart');
  rrecur = Rrecur.create(rrule);
  return rrecur.next();
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
  me._opts.interval = me._opts.interval || 15 * 60 * 1000;
  me._opts.window = me._opts.window || 24 * 60 * 60 * 1000;
  me._Models = Db;

  me._meta = me._Models.Meta.forge({ id: 'meta' }).fetch();

  /*
  setInterval(function () {
    me._load();
  }, this._opts.interval);
  */
  me._load();
}
util.inherits(Rescheduler, EventEmitter);
Rescheduler.create = Rescheduler;

p = Rescheduler.prototype;

p._load = function () {
  var me = this
    , now = Date.now() // lastrun
    , then = now + me._opts.interval + (5 * 24 * 60 * 60 * 1000)
    //, triggerTime = moment().utc().startOf('day').hours(22).valueOf()
    , triggerTime = moment().utc().startOf('day').hours(18).minutes(30).valueOf()
    ;

  function loadWindow(meta) {
    // time for the big load
    console.log("time to load lots of stuff", then, new Date(then).toISOString());
    me._Models.Schedules.where('next', '<', new Date(then).toISOString()) //.andWhere('next', '>=', meta.get('lastload'))
      .fetchAll({ withRelated: ['appointments'] }).then(function (_schedules) {
        var schedules = _schedules.map(function (s) { return s; })
          ;

        return forEachAsync(schedules, function (next, schedule) {
          var appts = schedule.related('appointments').map(function (a) { return a; })
            ;

          if (!appts.length) {
            console.log('create appointment');
            me._createAppointments(schedule).then(next);
          } else {
            forEachAsync(appts, function (n2, appt) {
              // although appt.related('schedule') returns a blank object,
              // it gets loaded again before the schedule is needed
              appt.relations.schedule = schedule;
              me._loadAppointment(appt).then(n2);
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
          me._loadAppointment(appt).then(n2);
        });
      }
    );

    // check for events that will fire before the next interval and load them into memory,
    // unless they're already in memory and haven't finished yet
    // TODO load current into memory
    meta.set('lastload', now);
    return meta.save();
  }

  //console.log('me._meta');
  //console.log(me._meta);
  me._meta.then(function (meta) {
    //console.log('meta');
    //console.log(meta);
    //console.log(meta.toJSON());
    loadWindow(meta);
    return;

    console.log(meta.get('lastload'), then, triggerTime, triggerTime - meta.get('lastload'));
    // if we'll hit 10pm UTC before the next interval, reload the window
    if (meta.get('lastload') <= triggerTime && then > triggerTime) {
      loadWindow(meta);
    } else {
      loadAppointments(meta);
    }
  });
};
p._createAppointments = function (schedule, appt) {
  var me = this
    , json = schedule.toJSON()
    , rrecur
    , next
    ;

  json.rrule = Rrecur.parse(json.rrule);
  json.rrule.dtstart = json.dtstart;
  rrecur = Rrecur.create(json.rrule);
  next = rrecur.next();

  if (!next) {
    console.error('nothing next');
  }

  appt = appt || me._Models.Appointments.forge();
  appt.set('next', next);
  appt.set('until', json.rrule.until);
  appt.set('scheduleId', schedule.id);
  //appt.attach(schedule);

  return appt.save().then(function () {
    if ((Date.now() - next.valueOf()) < me._opts.interval) {
      return me._loadAppointment(appt); // schedule.get('next')
    }
  });
};
p._loadAppointment = function (appt) {
  var me = this
    , apptId = appt.get('id')
    ;

  if (Date.now() < appt.get('until').valueOf()) {
    // TODO destroy stale
    console.log('TODO: delete this appt and schedule next');
    return appt.destroy();
  }

  return new Promise(function (resolve, reject) {
    if (me._timers[appt.get('id')]) {
      resolve();
      return;
    }

    me._timers[appt.get('id')] = true;

    function emitEvent() {
      console.log('TODO: load the next appointment for this schedule (or delete it)');
      me._Models.Appointments.forge({ id: apptId }).fetch({ withRelated: ['schedule'] }).then(function (appt) {
        var schedule = appt.related('schedule')
          , next = getNext(appt.related('schedule'))
          ;

        function doneCb() {
          delete me._timers[appt.get('id')];
          schedule.set('previous', appt.get('next'));
          schedule.set('next', next);

          if (next) {
            // TODO could maybe keep appt history, but recycling instead for now
            appt.set('next', next);
            // TODO some time delta appt.set('until', );
            appt.save(resolve, reject);
          } else {
            appt.destroy().then(function () {
              schedule.set('next', null);
              schedule.save(resolve, reject);
            });
          }
        }

        // TODO { appointment: appt }
        me.emit('appointment', appt.related('schedule').get('event'), appt, doneCb);
      });
    }

    setTimeout(emitEvent, appt.get('next') - Date.now());
  });
};

p.schedule = function (event, first, rrule) {
  var me = this
    , schedule
    ;

  first = first || Date.now();
  rrule = rrule || { freq: 'daily', count: 1, until: Date.now() + (72 * 60 * 60 * 1000) };
  schedule = { event: event, dtstart: first, rrule: rrule, dummy: true };
  if (!schedule.rrule.freq) {
    // once-only
    schedule.rrule.freq = 'daily';
    schedule.rrule.count = 1;
  }

  // TODO some figuring
  if ((Date.now() - first.valueOf()) < me._opts.interval) {
    // load to appointments (and memory)
    schedule.previous = null;
    schedule.next = first;
    schedule.until = rrule.until;
    // staletime instead of until
  }

  console.log('schedule');
  console.log(schedule);
  schedule.rrule = Rrecur.stringify(schedule.rrule);
  console.log(schedule);

  function logQuery(data) {
    console.log(data.sql);
    console.log(data.bindings);
  }
  return me._Models.Schedules.forge().on('query', logQuery).save(schedule).then(function (record) {
    return me._createAppointments(record).then(function () {
      return record;
    });
  }, function (err) {
    console.error('schedules save fail');
    console.error(err);
  });
};
p.pause = function (id) {
  return this._Models.Schedules.forge({ id: id }).fetch().then(function (schedule) {
    return schedule.set('next', null).save();
  });
};
p.resume = function (id) {
  return this._Models.Schedules.forge({ id: id }).fetch().then(function (schedule) {
    return schedule.set('next', getNext(schedule)).save();
  });
};
p.unschedule = function (id) {
  return this._Models.Schedules.forge({ id: id }).fetch().then(function (schedule) {
    var scheduleObj = schedule.toJSON();
    return schedule.destroy().then(function () {
      p.emit('unschedule', scheduleObj);
      return scheduleObj;
    });
  });
};
/*
p.postpone = function (id, date) {
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
