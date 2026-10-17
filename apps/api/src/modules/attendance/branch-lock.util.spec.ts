import { branchLockRejectReason, isSameBranchSite } from './branch-lock.util';

const gulberg = { id: 'b1', name: 'Gulberg', address: '12 Main Road, Lahore' };
const gulbergAnnex = {
  id: 'b2',
  name: 'Gulberg Annex',
  address: '  12 main   road, LAHORE ',
};
const johar = { id: 'b3', name: 'Johar Town', address: '5 Canal Bank' };
const headOffice = { id: 'b4', name: 'YCDO Head Office', address: 'HQ' };

describe('branch-lock.util', () => {
  it('allows the employee own branch device', () => {
    expect(
      branchLockRejectReason({
        employeeBranch: gulberg,
        deviceBranch: gulberg,
        twentyFourHour: false,
      }),
    ).toBeNull();
  });

  it('allows a branch at the same address (shared machine)', () => {
    expect(isSameBranchSite(gulberg, gulbergAnnex)).toBe(true);
    expect(
      branchLockRejectReason({
        employeeBranch: gulberg,
        deviceBranch: gulbergAnnex,
        twentyFourHour: false,
      }),
    ).toBeNull();
  });

  it('never matches two branches on empty addresses', () => {
    expect(
      isSameBranchSite({ id: 'x', address: ' ' }, { id: 'y', address: '' }),
    ).toBe(false);
  });

  it('allows Head Office staff on any device', () => {
    expect(
      branchLockRejectReason({
        employeeBranch: headOffice,
        deviceBranch: johar,
        twentyFourHour: false,
      }),
    ).toBeNull();
  });

  it('allows 24-hour staff on any device', () => {
    expect(
      branchLockRejectReason({
        employeeBranch: gulberg,
        deviceBranch: johar,
        twentyFourHour: true,
      }),
    ).toBeNull();
  });

  it('allows reliever / mutual swap duty at the covered branch', () => {
    expect(
      branchLockRejectReason({
        employeeBranch: gulberg,
        deviceBranch: johar,
        twentyFourHour: false,
        dutyBranches: [{ id: 'b3' }],
      }),
    ).toBeNull();
  });

  it('rejects another branch device with a clear reason', () => {
    expect(
      branchLockRejectReason({
        employeeBranch: gulberg,
        deviceBranch: johar,
        twentyFourHour: false,
        dutyBranches: [gulbergAnnex],
      }),
    ).toBe(
      'Punch from another branch device: Johar Town (employee branch Gulberg)',
    );
  });
});
