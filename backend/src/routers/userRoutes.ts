import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { UserService } from '../services/userService';
import { UserRepository } from '../repos/userRepository';
import { Knex } from 'knex';
import { RequestContext } from '../types/requestContext';

/** Build the users router and its shared repository/service dependencies. */

export function createUserRouter(db: Knex): Router {
  const router = Router();

  const userRepository = new UserRepository(db, 'users');
  const userService = new UserService(userRepository);


  /** Create a request-scoped controller for the list endpoint and forward async failures to Express. */

  router.get('/all', (req, res, next) => {
    const userController = new UserController(new RequestContext(req), userService);
    void userController.getAllUsers(req, res).catch(next);
  });

  return router;
}
