/**
 * An error whose message is written for the person at the dashboard. The dashboard shows any other error
 * only as a failure and logs its message, which may name a key, a database or another person.
 */
export class Refusal extends Error {}
