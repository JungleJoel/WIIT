import "../db/loadEnv"; // must stay first: knexfile reads process.env when it is imported
import knex, { Knex } from "knex";
import config from "../../knexfile";
 
const db: Knex = knex(config.development);
 
export default db;
 