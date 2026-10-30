/** The current time, passed in so that tests can move it. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
