/* oxlint-disable oxc/no-barrel-file -- Drizzle and Better Auth need every table in one schema module */
// Later tasks add their tables with one more `export *` line.
export * from './auth';
export * from './system';
