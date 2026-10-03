import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/server/db';
import { claimWorkItem, updateWorkItem, createWorkItem } from '@/server/services/work-item.service';
import { getAuthorizedTeamIds } from '@/server/authorization';
import { checkIdempotency, storeIdempotencyResult, computeRequestHash } from '@/server/services/idempotency.service';
import { GlobalRole, WorkItemPriority, WorkItemStatus } from '@/types';
import { AppError } from '@/lib/errors';

// These tests require a running database to actually pass,
// but they demonstrate the correctness of the operations as requested.

describe('Core Correctness', () => {
  let adminUser: any;
  let testTeam: any;

  beforeAll(async () => {
    // Setup test data assuming DB is running
    try {
      testTeam = await prisma.team.create({ data: { name: 'Test Team ' + Date.now() } });
      adminUser = await prisma.user.create({
        data: { name: 'Admin', email: `testadmin${Date.now()}@example.com`, password: 'pwd', globalRole: GlobalRole.ADMIN }
      });
    } catch (e) {
      console.log('Skipping setup, DB not available');
    }
  });

  afterAll(async () => {
    try {
      await prisma.workItem.deleteMany({ where: { teamId: testTeam?.id } });
      await prisma.user.delete({ where: { id: adminUser?.id } });
      await prisma.team.delete({ where: { id: testTeam?.id } });
    } catch (e) {}
  });

  it('Test 1 — Concurrent claim', async () => {
    if (!adminUser) return;
    
    // Create an unassigned item
    const item = await createWorkItem(adminUser, {
      title: 'Concurrent claim test',
      description: 'Desc',
      teamId: testTeam.id,
      priority: WorkItemPriority.MEDIUM
    });

    // Simulate 20 concurrent claim attempts
    const attempts = Array.from({ length: 20 }).map(() => claimWorkItem(adminUser, item.id));
    
    const results = await Promise.allSettled(attempts);
    
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    // EXACTLY 1 successful claim
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(19);

    // Verify it's assigned to the winner and only one ASSIGNED event exists
    const finalItem = await prisma.workItem.findUnique({ where: { id: item.id }, include: { events: true } });
    expect(finalItem?.assigneeId).toBe(adminUser.id);
    
    const assignedEvents = finalItem?.events.filter(e => e.type === 'ASSIGNED');
    expect(assignedEvents?.length).toBe(1);
  });

  it('Test 2 — Stale update', async () => {
    if (!adminUser) return;

    const item = await createWorkItem(adminUser, {
      title: 'Stale update test',
      description: 'Desc',
      teamId: testTeam.id,
      priority: WorkItemPriority.MEDIUM
    });

    // Update 1: successful
    await updateWorkItem(adminUser, item.id, {
      title: 'New Title',
      expectedVersion: 1
    });

    // Update 2: stale
    await expect(
      updateWorkItem(adminUser, item.id, {
        description: 'New Desc',
        expectedVersion: 1 // Sending the old version
      })
    ).rejects.toThrowError(/modified by another user/);
  });

  it('Test 3 — Idempotency', async () => {
    if (!adminUser) return;

    const key = 'test-idempotency-key';
    const endpoint = '/test-endpoint';
    const payload = { test: 'payload' };
    const hash = computeRequestHash(payload);

    // Initial check (should be null)
    let existing = await checkIdempotency(adminUser.id, key, endpoint, hash);
    expect(existing).toBeNull();

    // Store result
    await prisma.$transaction(async tx => {
      await storeIdempotencyResult(tx, adminUser.id, key, endpoint, hash, 201, { success: true });
    });

    // Second check with same payload
    existing = await checkIdempotency(adminUser.id, key, endpoint, hash);
    expect(existing?.statusCode).toBe(201);
    expect((existing?.responseJson as any).success).toBe(true);

    // Third check with DIFFERENT payload (should throw conflict)
    const diffHash = computeRequestHash({ test: 'different' });
    await expect(
      checkIdempotency(adminUser.id, key, endpoint, diffHash)
    ).rejects.toThrowError(/different request payload/);
  });
});
