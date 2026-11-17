import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo, Server } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import type { StorageInterface } from '../src/storage.js';

const organizationId = '33333333-3333-4333-8333-333333333333';
const attemptId = '66666666-6666-4666-8666-666666666666';
const trustedOrigin = 'https://examguard-sooty.vercel.app';
const secret = 'private-evidence-route-test-secret-at-least-32-chars';
const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const objectKey = `organizations/${organizationId}/attempts/${attemptId}/evidence/frame.jpg`;

test('private evidence permits trusted cross-origin image retrieval and rejects unauthorized access', async () => {
  const previousClientUrl = process.env.CLIENT_URL;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const overrides: Array<() => void> = [];
  const storageReads: string[] = [];
  let server: Server | undefined;

  function stub(target: object, method: string, implementation: unknown) {
    const record = target as Record<string, unknown>;
    const previous = Object.getOwnPropertyDescriptor(record, method);
    Object.defineProperty(record, method, { configurable: true, writable: true, value: implementation });
    overrides.push(() => {
      if (previous) Object.defineProperty(record, method, previous);
      else delete record[method];
    });
  }

  const storage: StorageInterface = {
    putPrivateDocument: async key => key,
    privateDocumentUrl: async () => '',
    storageConfigured: () => true,
    getPrivateDocument: async key => {
      storageReads.push(key);
      return key === objectKey ? image : null;
    },
  };
  const stopServer = (instance: Server) => new Promise<void>((resolve, reject) => {
    instance.close(error => error ? reject(error) : resolve());
  });

  try {
    process.env.CLIENT_URL = trustedOrigin;
    process.env.JWT_SECRET = secret;
    process.env.NODE_ENV = 'test';

    stub(prisma.evidenceObject, 'findUnique', async ({ where }: { where: { objectKey: string } }) =>
      where.objectKey === objectKey
        ? { organizationId, attemptId, mimeType: 'image/jpeg', sizeBytes: image.length }
        : null);
    stub(prisma.staffVerificationRequest, 'findFirst', async () => null);
    stub(prisma.verificationRequest, 'findFirst', async () => null);
    stub(prisma.institutionRequest, 'findFirst', async () => null);

    server = createApp(storage).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const makeToken = (key: string) => jwt.sign({ key }, secret, {
      audience: 'examguard-local-evidence',
      expiresIn: 60,
    });

    const authorized = await fetch(`${baseUrl}/api/private-evidence/${makeToken(objectKey)}`, {
      headers: { Origin: trustedOrigin },
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get('access-control-allow-origin'), trustedOrigin);
    assert.equal(authorized.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(authorized.headers.get('content-type'), 'image/jpeg');
    assert.equal(authorized.headers.get('content-length'), String(image.length));
    assert.equal(authorized.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(authorized.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await authorized.arrayBuffer()), image);

    const untrustedOrigin = await fetch(`${baseUrl}/api/private-evidence/${makeToken(objectKey)}`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    assert.equal(untrustedOrigin.status, 403);
    assert.equal(untrustedOrigin.headers.get('access-control-allow-origin'), null);
    assert.equal(untrustedOrigin.headers.get('cross-origin-resource-policy'), null);

    const noOrigin = await fetch(`${baseUrl}/api/private-evidence/${makeToken(objectKey)}`);
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get('cross-origin-resource-policy'), 'cross-origin');

    const invalidToken = await fetch(`${baseUrl}/api/private-evidence/not-a-valid-token`, {
      headers: { Origin: trustedOrigin },
    });
    assert.equal(invalidToken.status, 404);
    const expiredToken = jwt.sign({ key: objectKey }, secret, {
      audience: 'examguard-local-evidence',
      expiresIn: -1,
    });
    const expired = await fetch(`${baseUrl}/api/private-evidence/${expiredToken}`, {
      headers: { Origin: trustedOrigin },
    });
    assert.equal(expired.status, 404);
    const unassociatedKey = `organizations/${organizationId}/attempts/55555555-5555-4555-8555-555555555555/evidence/frame.jpg`;
    const unassociated = await fetch(`${baseUrl}/api/private-evidence/${makeToken(unassociatedKey)}`, {
      headers: { Origin: trustedOrigin },
    });
    assert.equal(unassociated.status, 404);
    assert.deepEqual(storageReads, [objectKey, objectKey]);

    const localEvidence = await fetch(`${baseUrl}/api/local-evidence/${makeToken(objectKey)}`, {
      headers: { Origin: trustedOrigin },
    });
    assert.equal(localEvidence.status, 200);
    assert.equal(localEvidence.headers.get('cross-origin-resource-policy'), 'same-site');

    await stopServer(server);
    server = undefined;
    delete process.env.CLIENT_URL;
    server = createApp(storage).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const fallbackAddress = server.address() as AddressInfo;
    const fallback = await fetch(`http://127.0.0.1:${fallbackAddress.port}/api/private-evidence/${makeToken(objectKey)}`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(fallback.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.deepEqual(storageReads, [objectKey, objectKey, objectKey, objectKey]);
  } finally {
    try {
      if (server?.listening) await stopServer(server);
    } finally {
      for (const restore of overrides.reverse()) restore();
      if (previousClientUrl === undefined) delete process.env.CLIENT_URL;
      else process.env.CLIENT_URL = previousClientUrl;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  }
});
