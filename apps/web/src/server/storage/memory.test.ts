import { createMemoryStorage } from './memory';
import { describeStorageContract, readyStorage } from './storage-contract';

describeStorageContract('The in-memory storage', async () => readyStorage(createMemoryStorage()));
