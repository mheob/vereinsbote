import { createMemoryStorage } from './memory';
import { describeStorageContract } from './storage-contract';

describeStorageContract('The in-memory storage', () => createMemoryStorage());
