'use strict';

module.exports.create = function (knex) {
  return knex.schema.createTable('schedules', function (t) {
    t.increments('id').notNullable().primary();
    t.uuid('uuid').index().unique().nullable();
    //t.string('id', 255).notNullable();
    //t.primary('id');

    t.timestamp('dtstart', true).notNullable();
    t.text('rrule').notNullable();
    t.timestamp('until').nullable();

    t.timestamp('previous').nullable();
    t.timestamp('next').nullable();

    t.json('event').notNullable();
    t.json('xattrs').notNullable().defaultTo(knex.raw("'{}'"));
    t.timestamps();
  }).then(function () {
    console.log('Created schedules');
    
    return knex.schema.createTable('appointments', function (t) {
      t.increments('id').notNullable().primary();

      //t.string('schedule_id', 255).notNullable().references('id').inTable('schedules');
      t.integer('schedule_id').notNullable().references('id').inTable('schedules');

      t.timestamp('next').notNullable();
      t.timestamp('until').notNullable();

      t.timestamps();
    });
  }).then(function () {
    console.log('Created appointments');

    return knex.schema.createTable('meta', function (t) {
      t.string('id', 255).notNullable();
      t.primary('id');

      t.json('xattrs').notNullable().defaultTo(knex.raw("'{}'"));
    });
  }).then(function () {
    console.log('Created meta');

    return knex('meta').insert({ id: 'meta', xattrs: '{ "lastload": 0, "counter": 0 }' });
  });
};
