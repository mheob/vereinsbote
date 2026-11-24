import { describe } from 'vite-plus/test';

import { createS3Storage } from './s3';
import { describeStorageContract } from './storage-contract';

/*
 * `TEST_S3_URL` = `http://<key>:<secret>@localhost:8333/vereinsbote`: the SeaweedFS of
 * `docker/compose.dev.yml` (CI sets it, too), with the bucket as the path.
 */
// oxlint-disable-next-line node/no-process-env -- the test runs only where an S3 service is offered
const url = process.env.TEST_S3_URL ?? '';

describe.skipIf(url === '')('s3 against SeaweedFS (needs TEST_S3_URL)', () => {
	describeStorageContract('The S3 storage', async () => {
		const parsed = new URL(url);
		return createS3Storage({
			accessKeyId: decodeURIComponent(parsed.username),
			bucket: parsed.pathname.slice(1),
			endpoint: new URL(parsed.origin),
			region: 'us-east-1',
			secretAccessKey: decodeURIComponent(parsed.password),
		});
	});
});
