import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login';

export const routes: Routes = [
    // endast för att visa login sida, ska vara startsida senare
  { path: '', component: LoginComponent }
];
