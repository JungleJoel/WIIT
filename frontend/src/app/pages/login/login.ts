import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  // krävs för ngModel som används i html, och för angulars formulärvalidering
  imports: [FormsModule],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})

export class LoginComponent {
  // bundna till formuläret via ngModel i html
  email = '';
  password = '';

  onSubmit(): void {
    // SSO will be implemented here in the future
    // Change to real API-call when SSO is implemented
    console.log("Login submitted.");
  }
}