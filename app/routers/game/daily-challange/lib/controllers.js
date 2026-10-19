/* eslint-disable prettier/prettier */
const { mongo } = require('mongoose');
const { DailyChallenge, DailyChallengeUser, User, Transaction, Settings } = require('../../../../models');
const { awsServices, challengeLogic } = require('../../../../utils');
const { mongodb } = require('../../../../utils');

const controllers = {};


controllers.allDailyChallengeList = async (req, res) => {
  try {
    const allChallenges = await DailyChallenge.find({
      isActive: true,
      eStatus: 'y',
    });
    return res.reply(message.successfully('All daily challenges retrieved'), { allChallenges });
  } catch (error) {
    return res.reply(message.server_error(), error.toString());
  }
};

controllers.dailyChallengeList = async (req, res) => {
  try {
    const now = _.Date.getDateWithTimezone();
    const today = now.startOf('day').toDate();
    const tomorrow = now.endOf('day').toDate();
    const weekStart = now.startOf('week').toDate();
    const weekEnd = now.endOf('week').toDate();
    const currentTime = new Date();

    // Reset expired challenges (both daily and weekly) - mark as completed if reset date passed
    await DailyChallengeUser.updateMany(
      {
        iUserId: req.user._id,
        dResetDate: { $lte: currentTime },
        isCompleted: false,
      },
      { $set: { isCompleted: true } }
    );

    // Fetch settings and all active challenges in parallel
    const [settings, allDailyChallenges, allWeeklyChallenges] = await Promise.all([
      Settings.findOne({}, { nDailyChallengeCount: 1, nWeeklyChallengeCount: 1, nVipBonusPercent: 1, _id: 0 }).lean(),
      DailyChallenge.find({ isActive: true, eStatus: 'y', eChallengePeriod: 'daily' })
        .select('sName sDescription eRewardType nRewardValue eChallengeType _id nTarget eType eChallengePeriod')
        .lean(),
      DailyChallenge.find({ isActive: true, eStatus: 'y', eChallengePeriod: 'weekly' })
        .select('sName sDescription eRewardType nRewardValue eChallengeType _id nTarget eType eChallengePeriod')
        .lean(),
    ]);

    // Fetch existing user challenges for today and current week in parallel
    const [dailyUserChallengesRaw, weeklyUserChallengesRaw] = await Promise.all([
      DailyChallengeUser.find({
        iUserId: req.user._id,
        dDate: { $gte: today, $lt: tomorrow },
        eStatus: 'y',
      })
        .select('-dUpdatedDate -dDate -__v')
        .populate({
          path: 'iDailyChallengeId',
          select: 'sName sDescription eRewardType nRewardValue eChallengeType _id nTarget eType eChallengePeriod',
          match: { eChallengePeriod: 'daily' },
        })
        .lean(),
      DailyChallengeUser.find({
        iUserId: req.user._id,
        dDate: { $gte: weekStart, $lte: weekEnd },
        eStatus: 'y',
      })
        .select('-dUpdatedDate -dDate -__v')
        .populate({
          path: 'iDailyChallengeId',
          select: 'sName sDescription eRewardType nRewardValue eChallengeType _id nTarget eType eChallengePeriod',
          match: { eChallengePeriod: 'weekly' },
        })
        .lean(),
    ]);

    // Filter out challenges where populate returned null (period mismatch)
    let dailyUserChallenges = dailyUserChallengesRaw.filter((challenge) => challenge.iDailyChallengeId);
    let weeklyUserChallenges = weeklyUserChallengesRaw.filter((challenge) => challenge.iDailyChallengeId);

    const nVipBonusPercent = settings?.nVipBonusPercent || 0;
    const isVipUser = req.user?.eUserType === 'vip';
    const vipDisplayReward = (baseReward) => {
      const base = Number(baseReward) || 0;
      if (!isVipUser || !nVipBonusPercent || nVipBonusPercent <= 0) return base;
      return base + Math.round((base * nVipBonusPercent) / 100);
    };

    // Helper function to format challenge response
    const formatChallenge = (doc) => {
      const obj = { ...doc };
      // isAbleToClaim only true when: isClaimed === false AND isCompleted === true
      obj.isAbleToClaim = obj.isCompleted === true && obj.isClaimed === false;
      if (obj.iDailyChallengeId) {
        obj.eType = obj.iDailyChallengeId.eType;
        obj.nRewardValue = vipDisplayReward(obj.iDailyChallengeId.nRewardValue);
        obj.sDescription = obj.iDailyChallengeId.sDescription;
        obj.eChallengePeriod = obj.iDailyChallengeId.eChallengePeriod;
      }
      delete obj.iDailyChallengeId;
      if (obj.dailyChallenge && obj.dailyChallenge._id) delete obj.dailyChallenge._id;
      return obj;
    };

    // Helper function to create challenges from selected challenges
    const createUserChallenges = async (selectedChallenges, dDate, dResetDate) => {
      const challengesToCreate = selectedChallenges.map((challenge) => ({
        iUserId: req.user._id,
        iDailyChallengeId: challenge._id,
        nProgress: 0,
        isCompleted: false,
        isClaimed: false,
        dDate,
        dResetDate,
        eStatus: 'y',
        eChallengeType: challenge.eChallengeType,
        nTarget: challenge.nTarget,
      }));

      const createdChallenges = await DailyChallengeUser.insertMany(challengesToCreate);

      // Format directly from created challenges and selected challenges (avoid extra query)
      return createdChallenges.map((created, index) => {
        const challengeData = selectedChallenges[index];
        return formatChallenge({
          ...created.toObject(),
          iDailyChallengeId: challengeData,
        });
      });
    };

    // Create daily challenges if none exist for today
    if (!dailyUserChallenges.length) {
      if (!allDailyChallenges.length || allDailyChallenges.length < settings.nDailyChallengeCount) {
        return res.reply(message.not_found('Active daily challenges'));
      }

      const selectedDailyChallenges = _.getRandomChallenges(allDailyChallenges, settings.nDailyChallengeCount);
      const tomorrowStart = _.addDays(today, 1);
      dailyUserChallenges = await createUserChallenges(selectedDailyChallenges, today, tomorrowStart);
    } else {
      dailyUserChallenges = dailyUserChallenges.map(formatChallenge);
    }

    // Create weekly challenges if none exist for current week
    if (!weeklyUserChallenges.length) {
      if (!allWeeklyChallenges.length || allWeeklyChallenges.length < settings.nWeeklyChallengeCount) {
        return res.reply(message.not_found('Active weekly challenges'));
      }

      const selectedWeeklyChallenges = _.getRandomChallenges(allWeeklyChallenges, settings.nWeeklyChallengeCount);
      weeklyUserChallenges = await createUserChallenges(selectedWeeklyChallenges, weekStart, weekEnd);
    } else {
      weeklyUserChallenges = weeklyUserChallenges.map(formatChallenge);
    }

    return res.reply(message.successfully('Challenges retrieved'), {
      daily: dailyUserChallenges,
      weekly: weeklyUserChallenges,
    });
  } catch (error) {
    console.log(`🚀 ~file: controllers.js: 22 ~controllers.dailyChallengeList= ~error: `, error);
    return res.reply(message.server_error(), error);
  }
};

controllers.claimChallenge = async (req, res) => {
  try {
    const { iDailyChallengerId } = req.params; // the DailyChallengeUser _id

    const challengeUser = await DailyChallengeUser.findOne({
      _id: iDailyChallengerId,
      iUserId: req.user._id,
    }).populate('iDailyChallengeId');

    if (!challengeUser) return res.reply(message.not_found('Challenge'));
    if (!challengeUser.isCompleted) return res.reply(message.not_completed('Challenge'));
    if (challengeUser.isClaimed) return res.reply(message.already_claimed('Challenge'));


    const challenge = challengeUser.iDailyChallengeId;
    const rewardValue = challenge.nRewardValue || 0;
    const rewardType = challenge.eRewardType;

    if (!rewardValue || !rewardType) return;

    // Apply VIP bonus percent from settings for bonus-type rewards
    const settings = await Settings.findOne({}).lean();
    const vipBonusPercent = settings?.nVipBonusPercent || 0;
    let finalReward = rewardValue;
    if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
      finalReward += Math.round((rewardValue * vipBonusPercent) / 100);
    }
    log.info('VIP bonus check: Daily Challenge Rewards', {
      iUserId: req.user?._id?.toString?.() || req.user?._id,
      eUserType: req.user?.eUserType,
      challengeId: challenge?._id?.toString?.() || challenge?._id,
      rewardType,
      baseReward: rewardValue,
      vipBonusPercent,
      vipBonusAmount: finalReward - rewardValue,
      finalReward,
    });

    const updateField = rewardType === 'nChips' ? { nTotalCoins: finalReward } : { nTotalCoins: 0 };

    await User.updateOne({ _id: req.user._id }, { $inc: updateField });
    await DailyChallengeUser.updateOne(
      {
        _id: iDailyChallengerId,
        iUserId: req.user._id,
      },
      { $set: { isClaimed: true } }
    );

    return res.reply(message.successfully('Challenge claimed'), {});
  } catch (error) {
    return res.reply(message.server_error(), error.toString());
  }
};

module.exports = controllers;
