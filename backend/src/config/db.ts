import knex from "knex";
import config from '../knexfile'

const enviroment = process.env.NODE_ENV || 'development';

export const db = knex(config[enviroment]);
