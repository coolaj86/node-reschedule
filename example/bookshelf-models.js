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

    if ('string' === typeof xattrs && -1 !== ['"','{','[','n','t','f','1','2','3','4','5','6','7','8','9'].indexOf(xattrs[0])) {
      xattrs = JSON.parse(xattrs);
    } else {
      console.warning("WARNING: Don't store strings in a json field");
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
  console.log('zipkeys');
  console.log(keys);
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
    console.log('zipXattrs');
    console.log(attrs);
    return attrs;
  };
}

function init(knex, schedColumns, apptColumns) {
  var Orm = require('bookshelf').initialize(knex)
    , Db = {}
    ;

  console.log(schedColumns);
  Db.Schedules = Orm.Model.extend({
    tableName: 'schedules'
  , idAttribute: 'id'
  , hasTimestamps: ['createdAt', 'updatedAt']
  , format: function (attrs) {
      if ('text' === schedColumns.xattrs.type) {
        //attrs.xattrs = JSON.stringify(attrs.xattrs);
        attrs = zipXattrs('xattrs', toCamelCaseArr(Object.keys(schedColumns)), 'text')(attrs);
      } else {
        attrs = zipXattrs('xattrs', toCamelCaseArr(Object.keys(schedColumns)), 'json')(attrs);
      }
      if ('text' === schedColumns.event.type) {
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
      if ('text' === schedColumns.event.type) {
        attrs.event = JSON.parse(attrs.event);
      }
      attrs.xattrs = attrs.xattrs || {};
      return attrs;
    }
  });

  Db.Appointments = Orm.Model.extend({
    tableName: 'appointments'
  , idAttribute: 'id'
  , hasTimestamps: ['createdAt', 'updatedAt']
  , schedule: function () {
      this.belongsTo(Db.Schedules, 'schedule_id');
    }
  , format: zipXattrs('xattrs', toCamelCaseArr(Object.keys(apptColumns)))
  , parse: inflateXattrs('xattrs')
  });

  Db.Meta = Orm.Model.extend({
    tableName: 'meta'
  , idAttribute: 'id'
  , format: zipXattrs('xattrs', [])
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
      //console.log('schedColumns');
      //console.log(schedColumns);
      console.log(Object.keys(schedColumns));
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
