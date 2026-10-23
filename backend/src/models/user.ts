export interface User {
  nameID: string;
  nameIDFormat: string;
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  attributes?: any;
  roles?: string[];
}
