'use strict';

var Knex = require('knex')
  , path = require('path')
  ;

module.exports.create = function (filename) {
  return Knex.initialize({
    client: 'sqlite3'
  , connection: {
      filename : filename || path.join(__dirname, 'db.sqlite3')
    , debug: true
    }
  });
};
