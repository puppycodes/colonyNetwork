/* globals artifacts */
import testHelper from '../helpers/test-helper';
import testDataGenerator from '../helpers/test-data-generator';


const EtherRouter = artifacts.require('EtherRouter');
const IColony = artifacts.require('IColony');
const IColonyNetwork = artifacts.require('IColonyNetwork');
const Token = artifacts.require('Token');
const ReputationMiningCycle = artifacts.require('ReputationMiningCycle');

const BigNumber = require('bignumber.js');

BigNumber.config({ ERRORS: false });


contract('ColonyNetwork', (accounts) => {
  const MAIN_ACCOUNT = accounts[0];
  const OTHER_ACCOUNT = accounts[1];


  let commonColony;
  let colonyNetwork;
  let clny;

  before(async () => {
    const etherRouter = await EtherRouter.deployed();
    colonyNetwork = await IColonyNetwork.at(etherRouter.address);
    // await upgradableContracts.setupColonyVersionResolver(colony, colonyFunding, colonyTask, colonyTransactionReviewer, resolver, colonyNetwork);

    const commonColonyAddress = await colonyNetwork.getColony('Common Colony');
    commonColony = IColony.at(commonColonyAddress);
    // console.log('CC address ', commonColonyAddress);
    const clnyAddress = await commonColony.getToken.call();
    // console.log('CLNY address ', clnyAddress);
    clny = Token.at(clnyAddress);
  });

  before(async () => {
    await colonyNetwork.startNextCycle();
  });

  async function giveUserCLNYTokens(address, amount) {
    const mainStartingBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    const targetStartingBalance = await clny.balanceOf.call(address);
    await commonColony.mintTokens(amount * 1.1);
    await commonColony.claimColonyFunds(clny.address);
    const taskId = await testDataGenerator.setupRatedTask(commonColony, undefined, undefined, undefined, undefined, 1.1 * amount, 0);
    await commonColony.finalizeTask(taskId);
    await commonColony.claimPayout(taskId, 0, clny.address);

    let mainBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    clny.transfer(0x0, mainBalance.minus(amount).minus(mainStartingBalance));
    await clny.transfer(address, amount);

    mainBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    if (address !== MAIN_ACCOUNT) {
      await clny.transfer(0x0, mainBalance.minus(mainStartingBalance));
    }

    const userBalance = await clny.balanceOf.call(address);
    assert.equal(targetStartingBalance.add(amount).toNumber(), userBalance.toNumber());
  }

  afterEach(async () => {
    // Withdraw all stakes. Can only do this at the start of a new cycle, if anyone has submitted a hash in this current cycle.
    const addr = await colonyNetwork.getReputationMiningCycle.call();
    const repCycle = ReputationMiningCycle.at(addr);
    const nSubmittedHashes = await repCycle.nSubmittedHashes.call();
    if (nSubmittedHashes > 0) {
      const nInvalidatedHashes = await repCycle.nInvalidatedHashes.call();
      if (nSubmittedHashes - nInvalidatedHashes === 1) {
        repCycle.confirmNewHash(0);
      } else {
        console.log("We're mid dispute process, and can't untangle from here"); // eslint-disable-line no-console
        process.exit(1);
      }
    }
    let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
    if (stakedBalance.toNumber() > 0) {
      await colonyNetwork.withdraw(stakedBalance.toNumber(), { from: OTHER_ACCOUNT });
    }
    stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
    if (stakedBalance.toNumber() > 0) {
      await colonyNetwork.withdraw(stakedBalance.toNumber(), { from: MAIN_ACCOUNT });
    }
    let userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
    await clny.transfer(0x0, userBalance, { from: OTHER_ACCOUNT });
    userBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    await clny.transfer(0x0, userBalance, { from: MAIN_ACCOUNT });
  });

  describe('when initialised', () => {
    it('should allow miners to stake CLNY', async () => {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 5000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(5000, { from: OTHER_ACCOUNT });
      const userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 4000);
      const stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 5000);
    });

    it('should allow miners to withdraw staked CLNY', async () => {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 5000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(5000, { from: OTHER_ACCOUNT });
      let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      await colonyNetwork.withdraw(stakedBalance.toNumber(), { from: OTHER_ACCOUNT });
      stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 0);
    });

    it('should not allow miners to deposit more CLNY than they have', async () => {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 10000, { from: OTHER_ACCOUNT });
      await testHelper.checkErrorRevert(colonyNetwork.deposit(10000, { from: OTHER_ACCOUNT }));
      const userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 9000);
      const stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 0);
    });

    it('should not allow miners to withdraw more CLNY than they staked, even if enough has been staked total', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, 9000);
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 9000, { from: OTHER_ACCOUNT });
      await clny.approve(colonyNetwork.address, 9000, { from: MAIN_ACCOUNT });
      await colonyNetwork.deposit(9000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(9000, { from: MAIN_ACCOUNT });
      await testHelper.checkErrorRevert(colonyNetwork.withdraw(10000, { from: OTHER_ACCOUNT }));
      const stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 9000);
      const userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 0);
    });

    // it('should allow a new cycle to start if there is none currently', async function(){
    //   let addr = await colonyNetwork.getReputationMiningCycle.call();
    //   assert(addr==0x0);
    //   await colonyNetwork.startNextCycle();
    //   addr = await colonyNetwork.getReputationMiningCycle.call();
    //   assert(addr!=0x0);
    // })

    it('should allow a new reputation hash to be submitted', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      const submitterAddress = await repCycle.submittedHashes.call('0x12345678', 10, 0);
      assert.equal(submitterAddress, MAIN_ACCOUNT);
    });

    it('should not allow someone to submit a new reputation hash if they are not staking', async () => {
      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600);
      const repCycle = ReputationMiningCycle.at(addr);
      await testHelper.checkErrorRevert(repCycle.submitNewHash('0x12345678', 10, 0));
      const nSubmittedHashes = await repCycle.nSubmittedHashes.call();
      assert(nSubmittedHashes.equals(0));
    });

    it('should not allow someone to withdraw their stake if they have submitted a hash this round', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      let stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
      await testHelper.checkErrorRevert(colonyNetwork.withdraw(stakedBalance.toNumber(), { from: MAIN_ACCOUNT }));
      stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
      assert(stakedBalance.equals('1000000000000000000'));
    });
    it('should allow a new reputation hash to be set if only one was submitted');
    it('should not allow a new reputation hash to be set if more than one was submitted and they have not been elimintated');
    it('should allow a new reputation hash to be set if more than one was submitted and all but one have been elimintated');
    it('should not allow the last reputation hash to be eliminated');
    it('should not allow someone to submit a new reputation hash if they are ineligible');
    it('should not allow a new reputation hash to be set if two or more were submitted');
    it('should punish stakers if they misbehave');
    it('should reward stakers if they submitted the agreed new hash');
  });
});
