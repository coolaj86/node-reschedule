'use strict';

var _ = require('lodash')
  ;

_.str = require('underscore.string');

function toSnakeCase(attrs) {
  return _.reduce(attrs, function(memo, val, key) {
    memo[_.str.underscored(key)] = val;
    return memo;
  }, {});
}

function toCamelCaseArr(keys) {
  return _.reduce(keys, function(memo, key, i) {
    memo[i] = _.str.camelize(key);
    return memo;
  }, []);
}
function toCamelCase(attrs) {
  return _.reduce(attrs, function(memo, val, key) {
    memo[_.str.camelize(key)] = val;
    return memo;
  }, {});
}

function inflateXattrs(xattrKey, keys) {
  xattrKey = xattrKey || 'xattrs';
  keys = keys || [];

  return function (attrs) {
    attrs = toCamelCase(attrs);

    var xattrs = attrs[xattrKey] || {}
        // escape xattrKey?
      , keys = Object.keys(attrs)
      ;

    if ('string' === typeof xattrs) {
      if (-1 !== ['"','{','[','n','t','f','1','2','3','4','5','6','7','8','9'].indexOf(xattrs[0])) {
        xattrs = JSON.parse(xattrs);
      } else {
        console.warn("WARNING: Don't store strings in a json field");
      }
    }
    delete attrs[xattrKey];

    Object.keys(xattrs).forEach(function (key) {
      if (!attrs.hasOwnProperty(key) && -1 === keys.indexOf(key)) {
        attrs[key] = xattrs[key];
      }
    });

    return attrs;
  };
}

function zipXattrs(xattrKey, keys, emulate) {
  return function (attrs) {
    var xattrs = {}
      ;

    Object.keys(attrs).forEach(function (key) {
      if (-1 === keys.indexOf(key)) {
        xattrs[key] = attrs[key];
        delete attrs[key];
      }
    });

    // This is VERY important because a fetch
    // should not be string-matching the json blob
    if (Object.keys(xattrs).length) {
      if ('text' === emulate) {
        attrs.xattrs = JSON.stringify(xattrs);
      } else {
        attrs.xattrs = xattrs;
      }
    }

    attrs = toSnakeCase(attrs);
    return attrs;
  };
}

function init(knex, schedColumns, apptColumns) {
  var Orm = require('bookshelf').initialize(knex)
    , Db = {}
    , emu = schedColumns.xattrs.type
    ;

  //console.log(schedColumns);
  Db.Schedules = Orm.Model.extend({
    tableName: 'schedules'
  , idAttribute: 'id'
  , hasTimestamps: ['createdAt', 'updatedAt']
  , appointments: function () {
      return this.hasMany(Db.Appointments, 'schedule_id');
    }
  , format: function (attrs) {
      if ('text' === emu) {
        //attrs.xattrs = JSON.stringify(attrs.xattrs);
        attrs = zipXattrs('xattrs', toCamelCaseArr(Object.keys(schedColumns)), 'text')(attrs);
      } else {
        attrs = zipXattrs('xattrs', toCamelCaseArr(Object.keys(schedColumns)), 'json')(attrs);
      }
      Object.keys(schedColumns).forEach(function (key) {
        if ('datetime' === schedColumns[key].type) {
          if (!attrs[key]) {
            return;
          }
          if ('number' === typeof attrs[key]) {
            attrs[key] = new Date(attrs[key]).toISOString();
          }
          if ('object' === typeof attrs[key]) {
            attrs[key] = attrs[key].toISOString();
          }
        }
      });
      if (attrs.event && 'text' === schedColumns.event.type) {
        attrs.event = JSON.stringify(attrs.event);
      }
      return attrs;
    }
    // parse while retrieving
  , parse: function (attrs) {
      if ('text' === schedColumns.xattrs.type) {
        //attrs.xattrs = JSON.parse(attrs.xattrs);
        attrs = inflateXattrs('xattrs')(attrs);
      } else {
        attrs = inflateXattrs('xattrs')(attrs);
      }
      if (attrs.event && 'text' === schedColumns.event.type) {
        attrs.event = JSON.parse(attrs.event);
      }
      return attrs;
    }
  });

  Db.Appointments = Orm.Model.extend({
    tableName: 'appointments'
  , idAttribute: 'id'
  , hasTimestamps: ['createdAt', 'updatedAt']
  , schedule: function () {
      return this.belongsTo(Db.Schedules, 'schedule_id');
    }
  , format: function (attrs) {
      attrs = zipXattrs('xattrs', toCamelCaseArr(Object.keys(apptColumns)), emu)(attrs);

      Object.keys(apptColumns).forEach(function (key) {
        if ('datetime' === apptColumns[key].type) {
          if (!attrs[key]) {
            return;
          }
          if ('number' === typeof attrs[key]) {
            attrs[key] = new Date(attrs[key]).toISOString();
          }
          if ('object' === typeof attrs[key]) {
            attrs[key] = attrs[key].toISOString();
          }
        }
      });

      return attrs;
    }
  , parse: inflateXattrs('xattrs')
  });

  Db.Meta = Orm.Model.extend({
    tableName: 'meta'
  , idAttribute: 'id'
  , format: zipXattrs('xattrs', ['id'], emu)
  , parse: inflateXattrs('xattrs')
  });

  return Db;
}

function check(knex) {
  return knex('schedules').columnInfo().then(function (schedColumns) {
    if (0 === Object.keys(schedColumns).length) {
      return require('./migrations').then(function () {
        return check(knex);
      });
    }

    return knex('appointments').columnInfo().then(function (apptColumns) {
      return init(
        knex
      , schedColumns
      , apptColumns
      );
    });
  }, function (err) {
    console.error('err');
    console.error(err);
    return require('./migrations').then(function () {
      return check(knex);
    });
  });
}

module.exports.create = check;
