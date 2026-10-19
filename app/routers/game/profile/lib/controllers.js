/* eslint-disable no-continue */
/* eslint-disable no-shadow */
const axios = require('axios');
const mongoose = require('mongoose');
const { User, ClubMember, Settings, UserAchievements, Achievements, DailyGifts, TimelyBonus, SpinBonus, LoginStreakReward, DailyChallenge, TableHistory, TournamentUser } = require('../../../../models');
const DailyChallangeUser = require('../../../../models/lib/DailyChallangeUser');
const { email, s3, redis } = require('../../../../utils');

const controllers = {};

// Helper function to calculate game statistics
const calculateGameStatistics = async (iUserId) => {
    try {
        // Find all games where user participated
        const userGames = await TableHistory.find({
            'aPlayer.iUserId': iUserId,
        })
            .select('aPlayer iWinnerId dCreatedDate eGameType bIsTournament nTableFee nTotalRound')
            .sort({ dCreatedDate: 1 })
            .lean();

        let nGamesPlayed = 0;
        let nTotalMoneyEarned = 0;
        let nTotalMoneySpent = 0;
        let nFastestWin = null;
        let nWins = 0;
        let lastWinDate = null;
        let nBestWin = 0;
        let nLongestWinStreak = 0;
        let nSewaliGames = 0;
        let nCharwaliGames = 0;
        let nTournamentGames = 0;
        let nTournamentWins = 0;
        let nGamesThisWeek = 0;
        let nGamesThisMonth = 0;

        // Calculate date ranges
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Process each game
        for (const game of userGames) {
            const playerData = game.aPlayer?.find((p) => p.iUserId?.toString() === iUserId.toString());
            if (playerData) {
                nGamesPlayed += 1;

                // Calculate money spent (table fee paid upfront when joining)
                const tableFee = game.nTableFee || 0;
                const totalRounds = game.nTotalRound || 1;
                const moneySpentOnGame = tableFee * totalRounds;
                nTotalMoneySpent += moneySpentOnGame;

                // Calculate money earned (balance represents net winnings)
                const balance = playerData.nBalance || 0;
                if (balance > 0) {
                    nTotalMoneyEarned += balance;
                }

                // Check if user won this game
                const isWinner = game.iWinnerId?.toString() === iUserId.toString();
                if (isWinner) {
                    nWins += 1;
                    nLongestWinStreak += 1;

                    // Track best win (only for games actually won)
                    if (balance > nBestWin) {
                        nBestWin = balance;
                    }

                    // Calculate fastest win (time between consecutive wins)
                    if (lastWinDate) {
                        const timeDiff = game.dCreatedDate.getTime() - lastWinDate.getTime();
                        // Convert to seconds
                        const timeDiffInSeconds = Math.floor(timeDiff / 1000);

                        if (nFastestWin === null || timeDiffInSeconds < nFastestWin) {
                            nFastestWin = timeDiffInSeconds;
                        }
                    }
                    lastWinDate = game.dCreatedDate;
                }

                // Count game types
                if (game.eGameType === 'sewali') {
                    nSewaliGames += 1;
                } else if (game.eGameType === 'charwali') {
                    nCharwaliGames += 1;
                }

                // Count tournament games
                if (game.bIsTournament) {
                    nTournamentGames += 1;
                    if (isWinner) {
                        nTournamentWins += 1;
                    }
                }

                // Count games by time period
                const gameDate = game.dCreatedDate;
                if (gameDate >= oneWeekAgo) {
                    nGamesThisWeek += 1;
                }
                if (gameDate >= oneMonthAgo) {
                    nGamesThisMonth += 1;
                }
            }
        }

        // Calculate win rate percentage
        const nWinRate = nGamesPlayed > 0 ? Math.round((nWins / nGamesPlayed) * 100) : 0;

        // Calculate net profit/loss
        const nNetProfit = nTotalMoneyEarned - nTotalMoneySpent;

        // Calculate averages
        const nAvgMoneyPerGame = nGamesPlayed > 0 ? Math.round(nTotalMoneyEarned / nGamesPlayed) : 0;
        const nAvgMoneyPerWin = nWins > 0 ? Math.round(nTotalMoneyEarned / nWins) : 0;

        // If no fastest win found (only one win or no wins), set to null or 0
        if (nFastestWin === null) {
            nFastestWin = 0;
        }

        // Get tournament statistics
        const tournamentStats = await TournamentUser.aggregate([
            { $match: { iUserId } },
            {
                $group: {
                    _id: null,
                    nTotalTournaments: { $sum: 1 },
                    nTotalTournamentWins: { $sum: { $cond: [{ $gt: ['$nTournamentRoundWon', 0] }, 1, 0] } },
                    nTotalTournamentEarnings: { $sum: '$nAmountWon' },
                },
            },
        ]);

        const tournamentData = tournamentStats[0] || {
            nTotalTournaments: 0,
            nTotalTournamentWins: 0,
            nTotalTournamentEarnings: 0,
        };

        // Get achievement statistics
        const achievementStats = await UserAchievements.aggregate([
            { $match: { iUserId } },
            {
                $group: {
                    _id: null,
                    nTotalAchievements: { $sum: 1 },
                    nCompletedAchievements: {
                        $sum: {
                            $cond: [{ $eq: ['$bIsCompleted', true] }, 1, 0],
                        },
                    },
                },
            },
        ]);

        const achievementData = achievementStats[0] || {
            nTotalAchievements: 0,
            nCompletedAchievements: 0,
        };

        // Get account age
        const userAccount = await User.findOne({ _id: iUserId }, { dCreatedDate: 1 }).lean();
        const nAccountAgeDays = userAccount?.dCreatedDate ? Math.floor((now.getTime() - new Date(userAccount.dCreatedDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;

        return {
            nGamesPlayed,
            nTotalMoneyEarned,
            nTotalMoneySpent,
            nNetProfit,
            nFastestWin,
            nWinRate,
            nBestWin,
            nLongestWinStreak,
            nAvgMoneyPerGame,
            nAvgMoneyPerWin,
            nSewaliGames,
            nCharwaliGames,
            nTournamentGames,
            nTournamentWins,
            nGamesThisWeek,
            nGamesThisMonth,
            nTotalTournaments: tournamentData.nTotalTournaments,
            nTotalTournamentWins: tournamentData.nTotalTournamentWins,
            nTotalTournamentEarnings: tournamentData.nTotalTournamentEarnings,
            nTotalAchievements: achievementData.nTotalAchievements,
            nCompletedAchievements: achievementData.nCompletedAchievements,
            nAccountAgeDays,
        };
    } catch (error) {
        log.error('calculateGameStatistics failed', error);
        // Return default values on error
        return {
            nGamesPlayed: 0,
            nTotalMoneyEarned: 0,
            nTotalMoneySpent: 0,
            nNetProfit: 0,
            nFastestWin: 0,
            nWinRate: 0,
            nBestWin: 0,
            nLongestWinStreak: 0,
            nAvgMoneyPerGame: 0,
            nAvgMoneyPerWin: 0,
            nSewaliGames: 0,
            nCharwaliGames: 0,
            nTournamentGames: 0,
            nTournamentWins: 0,
            nGamesThisWeek: 0,
            nGamesThisMonth: 0,
            nTotalTournaments: 0,
            nTotalTournamentWins: 0,
            nTotalTournamentEarnings: 0,
            nTotalAchievements: 0,
            nCompletedAchievements: 0,
            nAccountAgeDays: 0,
        };
    }
};

controllers.getProfile = async (req, res) => {
    try {
        const { _id } = _.pick(req.user, ['_id']);
        const query = { _id };
        const project = {
            _id: true,
            sUserName: true,
            sEmail: true,
            bIsEmailVerified: true,
            sAvatar: true,
            nWon: true,
            nLost: true,
            nTotalCoins: true,
            sReferralCode: true,
            sReferralLink: true,
            eBadges: true,
            eUserType: true,
            nTheamIndex: true,
        };

        const user = await User.findOne(query, project).lean();
        if (!user) return res.reply(message.not_found('user', req.query?.eLocale || user?.eLocale || 'en'));
        user.isVip = user.eUserType === 'vip';
        user.nTotalCoins = parseInt(user.nTotalCoins, 10);
        user.sReferralLink = `Hello Guys! Be a part of one of the most renowned 3 card rumble games globally, offering a wide range of tables and exciting tournaments. Immerse yourself in the fun! Download it right here: ${user.sReferralLink}. Don't forget to use my referral code: ${user.sReferralCode}.`;

        // Calculate game statistics from TableHistory
        const gameStats = await calculateGameStatistics(_id);

        // Add game statistics to user object
        user.nGamesPlayed = gameStats.nGamesPlayed;
        user.nTotalMoneyEarned = gameStats.nTotalMoneyEarned;
        user.nTotalMoneySpent = gameStats.nTotalMoneySpent;
        user.nNetProfit = gameStats.nNetProfit;
        user.nFastestWin = gameStats.nFastestWin;
        user.nWinRate = gameStats.nWinRate;
        user.nBestWin = gameStats.nBestWin;
        user.nLongestWinStreak = gameStats.nLongestWinStreak;
        user.nAvgMoneyPerGame = gameStats.nAvgMoneyPerGame;
        user.nAvgMoneyPerWin = gameStats.nAvgMoneyPerWin;
        user.nSewaliGames = gameStats.nSewaliGames;
        user.nCharwaliGames = gameStats.nCharwaliGames;
        user.nTournamentGames = gameStats.nTournamentGames;
        user.nTournamentWins = gameStats.nTournamentWins;
        user.nGamesThisWeek = gameStats.nGamesThisWeek;
        user.nGamesThisMonth = gameStats.nGamesThisMonth;
        user.nTotalTournaments = gameStats.nTotalTournaments;
        user.nTotalTournamentWins = gameStats.nTotalTournamentWins;
        user.nTotalTournamentEarnings = gameStats.nTotalTournamentEarnings;
        user.nTotalAchievements = gameStats.nTotalAchievements;
        user.nCompletedAchievements = gameStats.nCompletedAchievements;
        user.nAccountAgeDays = gameStats.nAccountAgeDays;
        // Add club membership info: isClubMember (boolean) and iClubId (string|null)
        try {
            const membership = await ClubMember.findOne({
                iUserId: req.user._id,
                eStatus: 'active',
            }).lean();
            if (membership) {
                // user.isClubMember = true;
                user.iClubId = membership.iClubId ? membership.iClubId.toString() : null;
            } else {
                // user.isClubMember = false;
                user.iClubId = null;
            }
        } catch (e) {
            // On error, don't fail the whole profile call; log and continue without club info
            log.error('getProfile.clubMembership check failed', e);
            user.isClubMember = false;
            user.iClubId = null;
        }

        return res.reply(message.successfully('', req.query?.eLocale || user?.eLocale || 'en'), user);
    } catch (error) {
        log.error('getProfile failed', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), {});
    }
};

// controllers.getLeaderBoard = (req, res) => {
//     const query = { bIsEmailVerified: true };
//     const project = {
//         _id: true,
//         sUserName: true,
//         sEmail: true,
//         sAvatar: true,
//         nTotalCoins: true,
//         eBadges: true,
//     };
//     User.find(query, project, (error, user) => {
//         if (error) return res.reply(message.server_error('', req.query?.eLocale || user?.eLocale || 'en'), {});
//         if (!user) return res.reply(message.not_found('user', req.query?.eLocale || user?.eLocale || 'en'));
//         const finalResponse = {};
//         finalResponse.total = user.slice(0, 25);
//         if (finalResponse.total.map((p) => p._id !== req.user._id)) {
//             const findInd = user.findIndex((element) => element._id.toString() === req.user._id.toString());
//             finalResponse.userDetail = { nRank: findInd, ...user[findInd] };
//         }
//         return res.reply(message.successfully('', req.query?.eLocale || user?.eLocale || 'en'), finalResponse);
//     })
//         .sort({ nTotalCoins: -1 })
//         .lean();
// };

controllers.getLeaderBoard = async (req, res) => {
    try {
        // Accept range: 'monthly' (default) or 'lifetime'
        const range = (req.query.range || req.body.range || 'monthly').toString().toLowerCase();
        // Calculate date 30 days ago
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Build conditional match for TableHistory
        const matchStages = [];
        if (range === 'monthly') matchStages.push({ $match: { dCreatedDate: { $gte: thirtyDaysAgo } } });
        // Aggregate games and calculate total coins/score per user
        const leaderboardAgg = await TableHistory.aggregate([
            // Conditional date match
            ...matchStages,
            // Unwind players array to process each player
            { $unwind: '$aPlayer' },
            // Fallback score calculation (some histories may not have aPlayer.nTotalScore populated)
            {
                $addFields: {
                    nScoreFromRounds: {
                        $sum: {
                            $map: {
                                input: { $ifNull: ['$aRoundInfo', []] },
                                as: 'r',
                                in: {
                                    $sum: {
                                        $map: {
                                            input: {
                                                $filter: {
                                                    input: { $ifNull: ['$$r.aDeclaredHand', []] },
                                                    as: 'h',
                                                    cond: { $eq: ['$$h.iUserId', '$aPlayer.iUserId'] },
                                                },
                                            },
                                            as: 'h2',
                                            in: { $ifNull: ['$$h2.nScore', { $ifNull: ['$$h2.oStatistics.nScore', 0] }] },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            // Group by user and sum coins (nBalance) and scores (nTotalScore)
            {
                $group: {
                    _id: '$aPlayer.iUserId',
                    sUserName: { $first: '$aPlayer.sUserName' },
                    nTotalCoinsEarned: { $sum: { $cond: [{ $gt: ['$aPlayer.nBalance', 0] }, '$aPlayer.nBalance', 0] } },
                    nTotalScore: {
                        $sum: {
                            $cond: [{ $gt: [{ $ifNull: ['$aPlayer.nTotalScore', 0] }, 0] }, { $ifNull: ['$aPlayer.nTotalScore', 0] }, { $ifNull: ['$nScoreFromRounds', 0] }],
                        },
                    },
                    nGamesPlayed: { $sum: 1 },
                    nWins: { $sum: { $cond: [{ $eq: ['$iWinnerId', '$aPlayer.iUserId'] }, 1, 0] } },
                },
            },
            // Lookup user details
            {
                $lookup: {
                    from: 'User',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userDetails',
                },
            },
            // Unwind user details
            { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
            // Filter only verified users
            { $match: { 'userDetails.bIsEmailVerified': true } },
            // Project final fields
            {
                $project: {
                    _id: 1,
                    sUserName: { $ifNull: ['$userDetails.sUserName', '$sUserName'] },
                    sAvatar: { $ifNull: ['$userDetails.sAvatar', ''] },
                    eBadges: '$userDetails.eBadges',
                    nTotalCoinsEarned: 1,
                    nTotalScore: 1,
                    nGamesPlayed: 1,
                    nWins: 1,
                },
            },
            // Sort by coins earned descending
            { $sort: { nTotalCoinsEarned: -1 } },
            // Limit to top 100
            { $limit: 100 },
        ]);

        // Add rank to each player
        const leaderboardWithRank = leaderboardAgg.map((player, index) => ({ ...player, nRank: index + 1 }));
        // Find current user's rank and details
        const currentUserId = req.user?._id?.toString();
        let userDetail = null;
        if (currentUserId) {
            const userIndex = leaderboardWithRank.findIndex((player) => player._id?.toString() === currentUserId);
            if (userIndex !== -1) {
                userDetail = leaderboardWithRank[userIndex];
            } else {
                // If user not in top list, find their position using same range
                const userMatchStages = [];
                if (range === 'monthly') userMatchStages.push({ $match: { dCreatedDate: { $gte: thirtyDaysAgo } } });

                const userStats = await TableHistory.aggregate([
                    ...userMatchStages,
                    { $unwind: '$aPlayer' },
                    { $match: { 'aPlayer.iUserId': mongoose.Types.ObjectId(currentUserId) } },
                    {
                        $addFields: {
                            nScoreFromRounds: {
                                $sum: {
                                    $map: {
                                        input: { $ifNull: ['$aRoundInfo', []] },
                                        as: 'r',
                                        in: {
                                            $sum: {
                                                $map: {
                                                    input: {
                                                        $filter: {
                                                            input: { $ifNull: ['$$r.aDeclaredHand', []] },
                                                            as: 'h',
                                                            cond: { $eq: ['$$h.iUserId', '$aPlayer.iUserId'] },
                                                        },
                                                    },
                                                    as: 'h2',
                                                    in: { $ifNull: ['$$h2.nScore', { $ifNull: ['$$h2.oStatistics.nScore', 0] }] },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$aPlayer.iUserId',
                            nTotalCoinsEarned: { $sum: { $cond: [{ $gt: ['$aPlayer.nBalance', 0] }, '$aPlayer.nBalance', 0] } },
                            nTotalScore: {
                                $sum: {
                                    $cond: [{ $gt: [{ $ifNull: ['$aPlayer.nTotalScore', 0] }, 0] }, { $ifNull: ['$aPlayer.nTotalScore', 0] }, { $ifNull: ['$nScoreFromRounds', 0] }],
                                },
                            },
                            nGamesPlayed: { $sum: 1 },
                            nWins: { $sum: { $cond: [{ $eq: ['$iWinnerId', '$aPlayer.iUserId'] }, 1, 0] } },
                        },
                    },
                ]);

                if (userStats.length > 0) {
                    const user = await User.findOne({ _id: currentUserId }, { sUserName: 1, sAvatar: 1, eBadges: 1 }).lean();
                    const userStat = userStats[0];

                    // Count how many users have higher coins earned in same range
                    const usersAboveMatch = [];
                    if (range === 'monthly') usersAboveMatch.push({ $match: { dCreatedDate: { $gte: thirtyDaysAgo } } });

                    const usersAbove = await TableHistory.aggregate([
                        ...usersAboveMatch,
                        { $unwind: '$aPlayer' },
                        {
                            $group: {
                                _id: '$aPlayer.iUserId',
                                nTotalCoinsEarned: { $sum: { $cond: [{ $gt: ['$aPlayer.nBalance', 0] }, '$aPlayer.nBalance', 0] } },
                            },
                        },
                        {
                            $lookup: {
                                from: 'User',
                                localField: '_id',
                                foreignField: '_id',
                                as: 'userDetails',
                            },
                        },
                        { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
                        { $match: { 'userDetails.bIsEmailVerified': true } },
                        { $match: { nTotalCoinsEarned: { $gt: userStat.nTotalCoinsEarned } } },
                        { $count: 'count' },
                    ]);

                    const rank = (usersAbove[0]?.count || 0) + 1;

                    userDetail = {
                        _id: currentUserId,
                        sUserName: user?.sUserName,
                        sAvatar: user?.sAvatar || '',
                        eBadges: user?.eBadges,
                        nTotalCoinsEarned: userStat.nTotalCoinsEarned,
                        nTotalScore: userStat.nTotalScore,
                        nGamesPlayed: userStat.nGamesPlayed,
                        nWins: userStat.nWins,
                        nRank: rank,
                    };
                } else {
                    // If user hasn't played any game in selected range, return default stats and rank 0
                    const user = await User.findOne({ _id: currentUserId }, { sUserName: 1, sAvatar: 1, eBadges: 1 }).lean();
                    userDetail = {
                        _id: currentUserId,
                        sUserName: user?.sUserName,
                        sAvatar: user?.sAvatar || '',
                        eBadges: user?.eBadges,
                        nTotalCoinsEarned: 0,
                        nTotalScore: 0,
                        nGamesPlayed: 0,
                        nWins: 0,
                        nRank: 0,
                    };
                }
            }
        }

        const finalResponse = {
            total: leaderboardWithRank.slice(0, 25), // Top 25 for display
            userDetail,
        };

        return res.reply(message.successfully('', req.query?.eLocale || req.user?.eLocale || 'en'), finalResponse);
    } catch (error) {
        log.error('getLeaderBoard failed', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), {});
    }
};

controllers.getSettings = async (req, res) => {
    let eLocale;
    try {
        const body = _.pick(req.user, ['bSoundEnabled', 'bVibrationEnabled', 'eLocale', 'nBackgroundId']);
        let [user, settings, [lastGift], [lastTimelyBonus], [lastSpinWheel]] = await Promise.all([
            User.findOne({ _id: req.user._id }, { eLocale: 1, nBackgroundId: 1, aUnlockedBackgroundIds: 1, eUserType: 1 }).lean(),
            Settings.findOne({}).lean(),
            DailyGifts.find({ iUserId: req.user._id }).sort({ timestamp: -1 }).limit(1),
            TimelyBonus.find({ iUserId: req.user._id }).sort({ dCreatedDate: -1 }).limit(1).lean(), //
            SpinBonus.find({ iUserId: req.user._id }).sort({ dCreatedDate: -1 }).limit(1).lean(), //
        ]);

        if (!settings) throw new Error('Settings not found');
        if (!user) throw new Error('User not found');
        eLocale = user.eLocale || 'en';
        body.eLocale = user.eLocale || 'en';
        body.nBackgroundId = user.nBackgroundId || 1;
        const nSpinAmount = 0;

        settings.aBackground = settings.aBackground.map((bg) => {
            if ((user.aUnlockedBackgroundIds || []).includes(bg?.nBackgroundId)) bg.bUnlocked = true;
            else bg.bUnlocked = false;
            return bg;
        });

        if (!lastGift) {
            // no gift present, create new day 1 gift
            lastGift = new DailyGifts({
                iUserId: req.user._id,
                iGiftId: settings.aDailyGifts[0]._id,
                nDays: settings.aDailyGifts[0].nDays,
                nDailyBonus: settings.aDailyGifts[0].nDailyBonus,
                eStatus: 'unclaimed',
                timestamp: Date.now(),
            });
            await lastGift.save();
            body.currentDay = lastGift.nDays;
            body.status = lastGift.eStatus;
            body.settings = [settings];
        } else {
            const day = lastGift.nDays;
            const nextDay = day === 7 ? 1 : day + 1;
            const { days } = _.calculateTimeDifference(lastGift.timestamp);

            if (days < 1) {
                // it means last gift is current days gift, i.e we need to return the same
                body.status = lastGift.eStatus;
                body.currentDay = lastGift.nDays;
                body.settings = [settings];
            } else if (days === 1) {
                // it means last gift is previous days gift, i.e we need to create new with unclaimed status, and nDays increated by 1 to lastGifts nDays
                const gift = new DailyGifts({
                    iUserId: req.user._id,
                    iGiftId: settings.aDailyGifts.find((g) => g.nDays === nextDay)?._id,
                    nDays: nextDay,
                    nDailyBonus: settings.aDailyGifts.find((g) => g.nDays === nextDay)?.nDailyBonus,
                    eStatus: 'unclaimed',
                    timestamp: Date.now(),
                });
                await gift.save();
                body.currentDay = gift.nDays;
                body.status = gift.eStatus;
                body.settings = [settings];
            } else {
                // it means last gift is older than 1 day, i.e we need create new with unclaimed status, and nDays as 1
                const gift = new DailyGifts({
                    iUserId: req.user._id,
                    iGiftId: settings.aDailyGifts[0]?._id,
                    nDays: 1,
                    nDailyBonus: settings.aDailyGifts[0]?.nDailyBonus,
                    eStatus: 'unclaimed',
                    timestamp: Date.now(),
                });
                await gift.save();
                body.currentDay = lastGift.nDays;
                body.status = lastGift.eStatus;
                body.settings = [settings];
            }
        }
        // ----------- TIMELY BONUS -----------------
        const handleTimelyBonus = async (nDelayInMinutes, nCoins, iUserId, oLastBonus) => {
            let bonus = oLastBonus;
            if (!bonus) {
                bonus = new TimelyBonus({ iUserId, nCoins, eStatus: 'unclaimed', dCreatedDate: new Date(), dUpdatedDate: new Date() });
                return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, 0), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'claimed') {
                bonus = new TimelyBonus({ iUserId, nCoins, dCreatedDate: new Date(), dUpdatedDate: new Date() });
                await Promise.all([
                    bonus.save(),
                    redis.setEx(_.getTimelyBonusKey(iUserId, bonus._id), nDelayInMinutes * 60, _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000)), //
                ]);
                return { dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: nDelayInMinutes * 60, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'unclaimed') return { dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            return { dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: Math.ceil(Math.max(new Date(bonus.dCreatedDate).getTime() + nDelayInMinutes * 60 * 1000 - Date.now(), 0) / 1000), eStatus: bonus.eStatus };
        };
        body.timelyBonus = await handleTimelyBonus(settings.nTimelyBonusDelay || 0, settings.nTimelyBonusCoins || 0, req.user._id, lastTimelyBonus);

        //

        // ----------- SPIN WHEEL BONUS -----------------
        const handleSpin = async (nDelayInMinutes, nCoins, iUserId, oLastBonus) => {
            let bonus = oLastBonus;
            if (!bonus) {
                bonus = new SpinBonus({ iUserId, nCoins, eStatus: 'unclaimed', dCreatedDate: new Date(), dUpdatedDate: new Date() });
                return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, 0), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'claimed') {
                bonus = new SpinBonus({ iUserId, nCoins, dCreatedDate: new Date(), dUpdatedDate: new Date() });
                await Promise.all([
                    bonus.save(),
                    redis.setEx(_.getSpinBonusKey(iUserId, bonus._id), nDelayInMinutes * 60, _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000)), //
                ]);
                return { dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: nDelayInMinutes * 60, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'unclaimed') return { dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            return { dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: Math.ceil(Math.max(new Date(bonus.dCreatedDate).getTime() + nDelayInMinutes * 60 * 1000 - Date.now(), 0) / 1000), eStatus: bonus.eStatus };
        };
        body.spinBonus = await handleSpin(settings.nSpinWheelDelay || 0, nSpinAmount || 0, req.user._id, lastSpinWheel);

        const isVipUser = user.eUserType === 'vip';
        const nVipBonusPercent = settings.nVipBonusPercent || 0;
        if (isVipUser && nVipBonusPercent > 0) {
            const vipRewardTotal = (base) => base + Math.round((base * nVipBonusPercent) / 100);
            body.nVipBonusPercent = nVipBonusPercent;
            if (body.timelyBonus && typeof body.timelyBonus.nCoins === 'number') {
                body.timelyBonus = { ...body.timelyBonus, nCoins: vipRewardTotal(body.timelyBonus.nCoins) };
            }
            if (body.spinBonus && typeof body.spinBonus.nCoins === 'number') {
                body.spinBonus = { ...body.spinBonus, nCoins: vipRewardTotal(body.spinBonus.nCoins) };
            }
            settings.nTimelyBonusCoins = vipRewardTotal(settings.nTimelyBonusCoins || 0);
            settings.aSpinAmount = (settings.aSpinAmount || []).map((n) => vipRewardTotal(Number(n) || 0));
            settings.aDailyGifts = (settings.aDailyGifts || []).map((g) => ({ ...g, nDailyBonus: vipRewardTotal(g.nDailyBonus || 0) }));
            settings.aLoginStreakRewards = (settings.aLoginStreakRewards || []).map((r) => ({ ...r, nReward: vipRewardTotal(r.nReward || 0) }));
        }

        return res.reply(message.successfully('', req.query?.eLocale || user?.eLocale || 'en'), body);
    } catch (err) {
        log.error(err);
        return res.reply(message.server_error('', req.query?.eLocale || eLocale || 'en'), {});
    }
};

controllers.getAchievements = async (req, res) => {
    const genResponse = (arr) => ({
        aUserAchievements: arr.map((ach) => {
            // delete ach.iAchievementId;
            delete ach.iUserId;
            delete ach.dCreatedDate;
            delete ach.dUpdatedDate;
            delete ach.__v;
            ach.aAchievements = ach.aAchievements.map((a) => {
                if (a.nTarget) {
                    a.nScore = Math.round((a.nProgress / a.nTarget) * 100);
                }
                return a;
            });
            return ach;
        }),
    });
    try {
        // 'current', 'claimed', 'unclaimed', 'none'
        let response;
        const [aUserAchievements, achievements] = await Promise.all([
            UserAchievements.find({ iUserId: req.user._id }, {}).lean(),
            Achievements.find({}, { _id: 0, eType: 1, bIsCompleted: 1, sTitle: 1, aAchievements: 1, iAchievementId: '$_id' }).sort({ _id: 1 }).lean(), //
        ]);
        if (!achievements.length) return res.reply(message.server_error('', req.query?.eLocale || 'en'), {});
        if (!aUserAchievements.length) {
            const userAchievements = achievements.map((achievement) => ({
                ...achievement,
                iUserId: req.user._id,
            }));
            const aUserAchievements = await UserAchievements.create(userAchievements);
            response = genResponse(aUserAchievements.map((a) => a.toObject()));
        } else if (achievements.length !== aUserAchievements.length) {
            // some achievements are missing and need to be added
            const missingAchievements = achievements.filter((achievement) => !aUserAchievements.some((userAchievement) => userAchievement.iAchievementId.toString() === achievement.iAchievementId.toString()));
            const userAchievements = missingAchievements.map((achievement) => ({
                ...achievement,
                iUserId: req.user._id,
            }));
            const newAchievements = await UserAchievements.create(userAchievements);
            response = genResponse([...aUserAchievements, ...newAchievements.map((a) => a.toObject())]);
        }
        response = response || genResponse(aUserAchievements);
        //
        const claimableReward = response?.aUserAchievements.filter((userAchievement) => userAchievement.aAchievements.some((achievement) => achievement.eState === 'unclaimed'));
        //
        const rest = response?.aUserAchievements.filter((userAchievement) => !userAchievement.aAchievements.some((achievement) => achievement.eState === 'unclaimed'));
        const nonClaimableReward = rest.map((item) => {
            const { aAchievements } = item;
            let activeItemIdx = 0;
            let activeItemScore = 0;
            let activeItemStatus = 'current';
            for (let i = 0; i < aAchievements.length; i += 1) {
                const achievement = aAchievements[i];
                //
                activeItemIdx = i;
                activeItemScore = achievement.nScore;
                activeItemStatus = achievement.eState;
                //
                if (achievement.nProgress < achievement.nTarget) break;
                else if (achievement.nProgress >= achievement.nTarget && achievement.eState === 'unclaimed') break;
                else continue; // claimed
            }
            //
            item.activeItemScore = activeItemScore;
            item.activeItemIdx = activeItemIdx;
            item.activeItemStatus = activeItemStatus;
            //
            return item;
        });

        //
        const alreadyClaimedRewards = nonClaimableReward.filter((item) => item.activeItemScore >= 100);
        const inProgressReward = nonClaimableReward.filter((item) => item.activeItemScore < 100).sort((a, b) => b.activeItemScore - a.activeItemScore);
        //
        response.aUserAchievements = [...claimableReward, ...inProgressReward, ...alreadyClaimedRewards].map((item) => {
            delete item.iAchievementId;
            delete item.activeItemScore;
            delete item.activeItemIdx;
            delete item.activeItemStatus;
            return item;
        });

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), [response]);
    } catch (err) {
        log.error(err);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), {});
    }
};

controllers.updateAchievementProgress = async (req, res) => {
    const body = _.pick(req.body, ['iAchievementId', 'nProgress']);
    if (['dev'].includes(process.env.NODE_ENV)) log.green(`updateAchievementProgress called with body: ${_.stringify(body)}`);
    body.nProgress = parseInt(body.nProgress);

    if (!body.iAchievementId) return res.reply(message.required_field('Achievement ID', req.query?.eLocale || 'en'));
    if (!body.nProgress) return res.reply(message.required_field('Progress', req.query?.eLocale || 'en'));
    if (body.nProgress < 1) return res.reply(message.invalid('Progress', req.query?.eLocale || 'en'));

    try {
        const userAchievements = await UserAchievements.find({ iUserId: req.user._id }).lean();
        if (!userAchievements.length) return res.reply(message.not_found('Achievements', req.query?.eLocale || 'en'), {});

        const achIdx = userAchievements.findIndex((achievement) => achievement._id.toString() === body.iAchievementId.toString());
        if (achIdx === -1) return res.reply(message.not_found('Parent Achievement', req.query?.eLocale || 'en'), {});

        const parentAchievement = userAchievements[achIdx];
        if (parentAchievement.bIsCompleted) return res.reply(message.successfully('Progress updated', req.query?.eLocale || 'en')); // - just to avoid warning: actual -> res.reply(message.already_completed('achievement', req.query?.eLocale || 'en'), {});

        let currentChild = parentAchievement.aAchievements[0];
        for (let i = 0; i < parentAchievement.aAchievements.length; i += 1) {
            const child = parentAchievement.aAchievements[i];
            currentChild = child;
            if (child.nProgress < child.nTarget) break;
            // else if (child.nProgress >= child.nTarget && child.eState === 'unclaimed') break;
            // else continue; // claimed
        }
        if (!currentChild) return res.reply(message.successfully('Progress updated', req.query?.eLocale || 'en')); // - just to avoid warning: actual -> res.reply(message.already_completed('achievement', req.query?.eLocale || 'en'), {});
        if (['claimed', 'unclaimed'].includes(currentChild.eState)) return res.reply(message.successfully('Progress updated', req.query?.eLocale || 'en')); // - just to avoid warning: actual -> res.reply(message.already_completed('achievement', req.query?.eLocale || 'en'), {}
        //
        currentChild.eState = 'current';
        currentChild.nProgress = Math.min(currentChild.nProgress + body.nProgress, currentChild.nTarget);
        if (currentChild.nProgress === currentChild.nTarget) currentChild.eState = 'unclaimed';
        // updating badge
        const beginnerAchievement = userAchievements.filter((ach) => ach.eType === 'beginner');
        const intermediateAchievement = userAchievements.filter((ach) => ach.eType === 'intermediate');
        const expertAchievement = userAchievements.filter((ach) => ach.eType === 'expert');

        const badgeUpdate = { eBadges: 'beginner' };
        if (beginnerAchievement.every((ach) => ach.bIsCompleted)) badgeUpdate.eBadges = 'intermediate';
        if (intermediateAchievement.every((ach) => ach.bIsCompleted)) badgeUpdate.eBadges = 'expert';
        if (expertAchievement.every((ach) => ach.bIsCompleted)) badgeUpdate.eBadges = 'expert';
        //
        await Promise.all([
            UserAchievements.updateOne({ _id: parentAchievement._id, 'aAchievements._id': currentChild._id }, { $set: { 'aAchievements.$.nProgress': currentChild.nProgress, 'aAchievements.$.eState': currentChild.eState } }),
            User.updateOne({ _id: req.user._id }, { $set: badgeUpdate }), //
        ]);
        return res.reply(message.successfully('Progress updated', req.query?.eLocale || 'en'));
    } catch (err) {
        log.error(err);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), {});
    }
};

controllers.achievementClaim = async (req, res) => {
    const body = _.pick(req.body, ['iAchievementId']);

    if (!body.iAchievementId) return res.reply(message.required_field('Achievement ID', req.query?.eLocale || 'en'));

    try {
        const [userAchievements, setting] = await Promise.all([
            UserAchievements.find({ iUserId: req.user._id }).lean(),
            Settings.findOne({}, { iAchieverId: 1 }).lean(), //
        ]);
        if (!userAchievements.length) return res.reply(message.not_found('Achievements', req.query?.eLocale || 'en'), {});
        if (!setting.iAchieverId) {
            log.error('iAchieverId not found in settings');
            return res.reply(message.not_found('Setting', req.query?.eLocale || 'en'), {});
        }

        const achIdx = userAchievements.findIndex((achievement) => achievement._id.toString() === body.iAchievementId.toString());
        if (achIdx === -1) return res.reply(message.not_found('Parent Achievement', req.query?.eLocale || 'en'), {});

        const parentAchievement = userAchievements[achIdx];
        if (parentAchievement.bIsCompleted) return res.reply(message.already_completed('achievement', req.query?.eLocale || 'en'), {});

        let currentChild = parentAchievement.aAchievements[0];
        for (let i = 0; i < parentAchievement.aAchievements.length; i += 1) {
            const child = parentAchievement.aAchievements[i];
            currentChild = child;
            if (child.nProgress < child.nTarget) break;
            else if (child.nProgress >= child.nTarget && child.eState === 'unclaimed') break;
            else continue; // claimed
        }
        if (!currentChild || currentChild.nProgress < currentChild.nTarget) return res.reply(message.not_eligible_to_claim('achievement', req.query?.eLocale || 'en'), {});
        currentChild.eState = 'claimed';

        parentAchievement.bIsCompleted = !!parentAchievement.aAchievements.every((ach) => ach.eState === 'claimed');
        // updating badge
        const beginnerAchievement = userAchievements.filter((ach) => ach.eType === 'beginner');
        const intermediateAchievement = userAchievements.filter((ach) => ach.eType === 'intermediate');
        const expertAchievement = userAchievements.filter((ach) => ach.eType === 'expert');

        const badgeUpdate = { eBadges: 'beginner' };
        if (beginnerAchievement.every((ach) => ach.bIsCompleted)) badgeUpdate.eBadges = 'intermediate';
        if (intermediateAchievement.every((ach) => ach.bIsCompleted)) badgeUpdate.eBadges = 'expert';
        if (expertAchievement.every((ach) => ach.bIsCompleted)) badgeUpdate.eBadges = 'expert';

        // update achiever
        const parentAchiever = userAchievements.find((ach) => ach.iAchievementId.toString() === setting.iAchieverId.toString());
        if (parentAchiever && setting.iAchieverId.toString() !== parentAchievement.iAchievementId.toString()) {
            let currentChildAchiever = parentAchiever.aAchievements[0];
            for (let i = 0; i < parentAchiever.aAchievements.length; i += 1) {
                const childAchiever = parentAchiever.aAchievements[i];
                currentChildAchiever = childAchiever;
                if (childAchiever.nProgress < childAchiever.nTarget) break;
                else if (childAchiever.nProgress >= childAchiever.nTarget && childAchiever.eState === 'unclaimed') break;
                else continue; // claimed
            }
            if (currentChildAchiever.nProgress < currentChildAchiever.nTarget) {
                currentChildAchiever.nProgress += 1;
                currentChildAchiever.eState = currentChildAchiever.nProgress >= currentChildAchiever.nTarget ? 'unclaimed' : 'current';
                parentAchiever.bIsCompleted = !!parentAchiever.aAchievements.every((ach) => ach.eState === 'claimed');
                await UserAchievements.updateOne({ _id: parentAchiever._id, 'aAchievements._id': currentChildAchiever._id }, { $set: { bIsCompleted: parentAchiever.bIsCompleted, 'aAchievements.$.eState': currentChildAchiever.eState, 'aAchievements.$.nProgress': currentChildAchiever.nProgress } });
            }
        } else log.error(`parentAchiever not found with setting.iAchieverId: ${setting.iAchieverId}`);
        //

        const [, user] = await Promise.all([
            UserAchievements.updateOne({ _id: parentAchievement._id, 'aAchievements._id': currentChild._id }, { $set: { bIsCompleted: parentAchievement.bIsCompleted, 'aAchievements.$.eState': currentChild.eState } }),
            User.findOneAndUpdate({ _id: req.user._id }, { $inc: { nTotalCoins: currentChild.nCoins }, $set: badgeUpdate }, { new: true, projection: { nTotalCoins: 1 } }), //
        ]);
        _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins, 10) });
        return res.reply(message.successfully('Achievement claimed', req.query?.eLocale || 'en'), badgeUpdate);
    } catch (err) {
        log.error(err);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), {});
    }
};

controllers.updateEmail = (req, res) => {
    const body = _.pick(req.body, ['sEmail']);

    if (req.user.sEmail === body.sEmail) return res.reply(message.already_exists('Email', req.query?.eLocale || 'en'));
    User.findOne({ sEmail: body.sEmail, _id: { $ne: req.user._id } }, (err, data) => {
        if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
        if (data) return res.reply(message.already_exists('Email', req.query?.eLocale || 'en'));

        User.findOneAndUpdate({ _id: req.user._id }, { $set: { sEmail: body.sEmail } }, (err, user) => {
            if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
            user.nOTP = _.salt(4);
            user.sVerificationToken = _.encodeToken(
                {
                    _id: user._id,
                    nOTP: user.nOTP,
                },
                { expiresIn: '3m' }
            );
            email.send(email.verify, {
                sEmail: body.sEmail,
                nOTP: user.nOTP,
                sUserName: user.sUserName,
            });

            // const encodedLink = _.encodeToken({ sEmail: body.sEmail });
            // const link = `${process.env.BASE_API_PATH}/auth/verify/email/${encodedLink}`;
            // email.send(email.verify, { sEmail: body.sEmail, link });

            user.save(_.errorCallback);
            return res.reply(message.successfully('Please verify your new email, Updated', req.query?.eLocale || 'en'), {}, { Verification: user.sVerificationToken });
        });
    });
};

controllers.updatePushToken = (req, res) => {
    const body = _.pick(req.body, ['sPushToken']);

    const query = { _id: req.user._id };
    const updateQuery = { sPushToken: body.sPushToken };
    User.findOneAndUpdate(query, { $set: updateQuery }, { new: true }, (error, updatedUser) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        return res.reply(message.successfully('Push Token Updated', req.query?.eLocale || 'en'), updatedUser);
    });
};

controllers.sendGift = async (req, res) => {
    const redLock = await globalThis.Lock.acquire([_.genLockKey(req.user._id, 'USR:UPD')], _.REDLOCK_TTL_MS);
    try {
        const body = _.pick(req.body, ['iReceiverId', 'nCoins']);

        if (!body.iReceiverId) return res.reply(message.required_field('Receiver ID', req.query?.eLocale || 'en'));
        if (!body.nCoins) return res.reply(message.required_field('Coins', req.query?.eLocale || 'en'));

        const senderQuery = { _id: req.user._id };
        const receiverQuery = { _id: body.iReceiverId };
        const response = {
            iUserId: req.user._id,
            iReceiverId: body.iReceiverId,
        };
        const sender = await User.findOne(senderQuery);
        if (!sender) return res.reply(message.not_found('sender', req.query?.eLocale || 'en'));
        const receiver = await User.findOne(receiverQuery);
        if (!receiver) return res.reply(message.not_found('receiver', req.query?.eLocale || 'en'));

        sender.nTotalCoins -= -body.nCoins;
        receiver.nTotalCoins += body.nCoins;

        response.userCoins = sender.nTotalCoins;
        response.receiverCoins = receiver.nTotalCoins;

        _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(sender.nTotalCoins, 10) });
        _.privateEmit(body.iReceiverId, 'resUpdateCoins', { nTotalCoins: parseInt(receiver.nTotalCoins, 10) });

        await Promise.all(sender.save(), receiver.save());

        // Update spendCoins daily challenge when sender spends coins
        (async () => {
            try {
                const baseUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:3401' : process.env.BASE_URL;
                await axios.post(
                    `${baseUrl}/api/v1/profile/daillyChallange/progress`,
                    {
                        eChallengeType: 'spendCoins',
                        nProgress: body.nCoins,
                    },
                    {
                        headers: {
                            Authorization: sender.sToken,
                            authorization: sender.sToken,
                        },
                        timeout: 4000,
                    }
                );
            } catch (e) {
                log.error('Failed to update spendCoins challenge in sendGift:', e?.message || e);
            }
        })();

        return res.reply(message.successfully('Gift coin updated', req.query?.eLocale || 'en'), response);
    } catch (error) {
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    } finally {
        if (redLock && redLock.expiration > Date.now()) {
            await redLock.release();
        } else log.red(`${_.now()}::sendGift(${req.user._id}):: redLock unable to release lock from key ${_.genLockKey(req.user._id, 'USR:UPD')}. auto released`);
    }
};

controllers.dailyGiftClaim = async (req, res) => {
    try {
        let [[lastGift], settings] = await Promise.all([
            DailyGifts.find({ iUserId: req.user._id }).sort({ timestamp: -1 }).limit(1),
            Settings.findOne({}, { aDailyGifts: 1, nVipBonusPercent: 1 }).lean(), //
        ]);
        if (!lastGift) {
            // no gift present, create new day 1 gift
            lastGift = new DailyGifts({
                iUserId: req.user._id,
                iGiftId: settings.aDailyGifts[0]._id,
                nDays: settings.aDailyGifts[0].nDays,
                nDailyBonus: settings.aDailyGifts[0].nDailyBonus,
                eStatus: 'claimed',
                timestamp: Date.now(),
            });
            // apply VIP bonus if applicable
            const vipBonusPercent = settings?.nVipBonusPercent || 0;
            let claimCoins = settings.aDailyGifts[0].nDailyBonus;
            if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
                claimCoins += Math.round((settings.aDailyGifts[0].nDailyBonus * vipBonusPercent) / 100);
            }
            log.info('VIP bonus check: Daily Gifts', {
                iUserId: req.user?._id?.toString?.() || req.user?._id,
                eUserType: req.user?.eUserType,
                baseReward: settings.aDailyGifts[0].nDailyBonus,
                vipBonusPercent,
                vipBonusAmount: claimCoins - settings.aDailyGifts[0].nDailyBonus,
                finalReward: claimCoins,
            });
            const [_player] = await Promise.all([
                User.findOneAndUpdate({ _id: req.user._id }, { $inc: { nTotalCoins: claimCoins } }, { new: true }),
                lastGift.save(), //
            ]);
            _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });
            return res.reply(message.successfully('Gift claimed', req.query?.eLocale || 'en'), {});
        }
        const day = lastGift.nDays;
        const nextDay = day === 7 ? 1 : day + 1;
        const { days } = _.calculateTimeDifference(lastGift.timestamp);

        if (days < 1) {
            // it means last gift is current days gift, i.e we need to return the same if its already claimed, else claim
            if (lastGift.eStatus === 'claimed') return res.reply(message.already_claimed('Gift', req.query?.eLocale || 'en'), {});
            lastGift.eStatus = 'claimed';
            const vipBonusPercent = settings?.nVipBonusPercent || 0;
            let claimCoins = lastGift.nDailyBonus;
            if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
                claimCoins += Math.round((lastGift.nDailyBonus * vipBonusPercent) / 100);
            }
            log.info('VIP bonus check: Daily Gifts', {
                iUserId: req.user?._id?.toString?.() || req.user?._id,
                eUserType: req.user?.eUserType,
                baseReward: lastGift.nDailyBonus,
                vipBonusPercent,
                vipBonusAmount: claimCoins - lastGift.nDailyBonus,
                finalReward: claimCoins,
            });
            const [_player] = await Promise.all([
                User.findOneAndUpdate({ _id: req.user._id }, { $inc: { nTotalCoins: claimCoins } }, { new: true }),
                lastGift.save(), //
            ]);
            _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });
        } else if (days === 1) {
            // it means last gift is previous days gift, i.e we need to create new with claimed status, and nDays incremented by 1 to lastGifts nDays
            const gift = new DailyGifts({
                iUserId: req.user._id,
                iGiftId: settings.aDailyGifts.find((g) => g.nDays === nextDay)?._id,
                nDays: nextDay,
                nDailyBonus: settings.aDailyGifts.find((g) => g.nDays === nextDay)?.nDailyBonus,
                eStatus: 'claimed',
                timestamp: Date.now(),
            });
            const vipBonusPercent = settings?.nVipBonusPercent || 0;
            let claimCoins = gift.nDailyBonus;
            if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
                claimCoins += Math.round((gift.nDailyBonus * vipBonusPercent) / 100);
            }
            log.info('VIP bonus check: Daily Gifts', {
                iUserId: req.user?._id?.toString?.() || req.user?._id,
                eUserType: req.user?.eUserType,
                baseReward: gift.nDailyBonus,
                vipBonusPercent,
                vipBonusAmount: claimCoins - gift.nDailyBonus,
                finalReward: claimCoins,
            });
            const [_player] = await Promise.all([
                User.findOneAndUpdate({ _id: req.user._id }, { $inc: { nTotalCoins: claimCoins } }, { new: true }),
                gift.save(), //
            ]);
            _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });
        } else {
            // it means last gift is older than 1 day, i.e we need create new with claimed status, and nDays as 1
            const gift = new DailyGifts({
                iUserId: req.user._id,
                iGiftId: settings.aDailyGifts[0]?._id,
                nDays: 1,
                nDailyBonus: settings.aDailyGifts[0]?.nDailyBonus,
                eStatus: 'claimed',
                timestamp: Date.now(),
            });
            const vipBonusPercent = settings?.nVipBonusPercent || 0;
            let claimCoins = gift.nDailyBonus;
            if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
                claimCoins += Math.round((gift.nDailyBonus * vipBonusPercent) / 100);
            }
            log.info('VIP bonus check: Daily Gifts', {
                iUserId: req.user?._id?.toString?.() || req.user?._id,
                eUserType: req.user?.eUserType,
                baseReward: gift.nDailyBonus,
                vipBonusPercent,
                vipBonusAmount: claimCoins - gift.nDailyBonus,
                finalReward: claimCoins,
            });
            const [_player] = await Promise.all([
                User.findOneAndUpdate({ _id: req.user._id }, { $inc: { nTotalCoins: claimCoins } }, { new: true }),
                gift.save(), //
            ]);
            _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(_player.nTotalCoins, 10) });
        }
        return res.reply(message.successfully('Gift claimed', req.query?.eLocale || 'en'), {});
    } catch (error) {
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.timelyBonusClaim = async (req, res) => {
    try {
        const [user, [lastTimelyBonus], settings] = await Promise.all([
            User.findOne({ _id: req.user._id }),
            TimelyBonus.find({ iUserId: req.user._id }).sort({ dCreatedDate: -1 }).limit(1),
            Settings.findOne({}, { nTimelyBonusCoins: 1, nTimelyBonusDelay: 1, nVipBonusPercent: 1 }).lean(), //
        ]);
        if (!settings) throw new Error('Settings not found');
        if (!user) return res.reply(message.not_found(`user`, req.query?.eLocale || 'en'), {});

        const handleTimelyBonus = async (nDelayInMinutes, nCoins, iUserId, oLastBonus) => {
            let bonus = oLastBonus;
            if (!bonus) {
                bonus = new TimelyBonus({ iUserId, nCoins, eStatus: 'unclaimed', dCreatedDate: new Date(), dUpdatedDate: new Date() });
                return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, 0), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'claimed') {
                bonus = new TimelyBonus({ iUserId, nCoins, dCreatedDate: new Date(), dUpdatedDate: new Date() });
                await Promise.all([
                    bonus.save(),
                    redis.setEx(_.getTimelyBonusKey(iUserId, bonus._id), nDelayInMinutes * 60, _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000)), //
                ]);
                return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: nDelayInMinutes * 60, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'unclaimed') return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: Math.ceil(Math.max(new Date(bonus.dCreatedDate).getTime() + nDelayInMinutes * 60 * 1000 - Date.now(), 0) / 1000), eStatus: bonus.eStatus };
        };

        const { bonus, eStatus, nCoins, nDelayInSec } = await handleTimelyBonus(settings.nTimelyBonusDelay || 0, settings.nTimelyBonusCoins || 0, req.user._id, lastTimelyBonus);
        if (eStatus === 'locked' && nDelayInSec) return res.reply(req.query?.eLocale === 'hi' ? message.noLocale(`${nDelayInSec} सेकंड तक प्रतीक्षा करें, फिलहाल यह क्लेम के लिए योग्य नहीं है`, 400) : message.noLocale(`Wait for ${nDelayInSec} sec as currently not eligible to claim`, 400));
        // claim when unclaimed
        bonus.eStatus = 'claimed';
        // apply VIP bonus for timely bonus
        {
            const vipBonusPercent = settings?.nVipBonusPercent || 0;
            let finalCoins = nCoins;
            if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
                finalCoins += Math.round((nCoins * vipBonusPercent) / 100);
            }
            log.info('VIP bonus check: Timely Bonus', {
                iUserId: req.user?._id?.toString?.() || req.user?._id,
                eUserType: req.user?.eUserType,
                baseReward: nCoins,
                vipBonusPercent,
                vipBonusAmount: finalCoins - nCoins,
                finalReward: finalCoins,
            });
            user.nTotalCoins += finalCoins;
        }
        // create new locked bonus
        const newBonus = new TimelyBonus({ iUserId: req.user._id, nCoins: settings.nTimelyBonusCoins || 0, dCreatedDate: new Date(), dUpdatedDate: new Date() });
        // set ttl
        await Promise.all([
            bonus.save(),
            user.save(),
            newBonus.save(),
            redis.setEx(_.getTimelyBonusKey(req.user._id, newBonus._id), (settings.nTimelyBonusDelay || 0) * 60, _.addMilliseconds(newBonus.dCreatedDate, (settings.nTimelyBonusDelay || 0) * 60 * 1000)), //
        ]);
        return res.reply(message.successfully('Timely Bonus claimed', req.query?.eLocale || 'en'), { eStatus: 'claimed', nTotalCoins: user.nTotalCoins });
    } catch (error) {
        log.error('timelyBonusClaim failed ', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.spinBonusClaim = async (req, res) => {
    try {
        const [user, [lastSpinWheel], settings] = await Promise.all([
            User.findOne({ _id: req.user._id }),
            SpinBonus.find({ iUserId: req.user._id }).sort({ dCreatedDate: -1 }).limit(1),
            Settings.findOne({}, { aSpinAmount: 1, nSpinWheelDelay: 1, nVipBonusPercent: 1 }).lean(), //
        ]);
        if (!settings) throw new Error('Settings not found');
        if (!user) return res.reply(message.not_found(`user`, req.query?.eLocale || 'en'), {});

        const nSpinAmount = Number(req.body.nAmount) || 0;
        if (!nSpinAmount) return res.reply(message.invalid('Spin Amount', req.query?.eLocale || 'en'));

        const aSpinAmount = settings.aSpinAmount || [];
        const vipBonusPercent = settings?.nVipBonusPercent || 0;
        const vipRewardTotal = (base) => base + Math.round((base * vipBonusPercent) / 100);
        const isVipWithBonus = user.eUserType === 'vip' && vipBonusPercent > 0;

        let nSpinBaseAmount = nSpinAmount;
        if (isVipWithBonus) {
            if (aSpinAmount.includes(nSpinAmount)) {
                nSpinBaseAmount = nSpinAmount;
            } else {
                const matchedBase = aSpinAmount.find((base) => vipRewardTotal(base) === nSpinAmount);
                if (!matchedBase) return res.reply(message.invalid('Spin Amount', req.query?.eLocale || 'en'));
                nSpinBaseAmount = matchedBase;
            }
        } else if (!aSpinAmount.includes(nSpinAmount)) {
            return res.reply(message.invalid('Spin Amount', req.query?.eLocale || 'en'));
        }

        const handleSpin = async (nDelayInMinutes, nCoins, iUserId, oLastBonus) => {
            let bonus = oLastBonus;
            if (!bonus) {
                bonus = new SpinBonus({ iUserId, nCoins, eStatus: 'unclaimed', dCreatedDate: new Date(), dUpdatedDate: new Date() });
                return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, 0), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'claimed') {
                bonus = new SpinBonus({ iUserId, nCoins, dCreatedDate: new Date(), dUpdatedDate: new Date() });
                await Promise.all([
                    bonus.save(),
                    redis.setEx(_.getSpinBonusKey(iUserId, bonus._id), nDelayInMinutes * 60, _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000)), //
                ]);
                return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: nDelayInMinutes * 60, eStatus: bonus.eStatus };
            }
            if (bonus?.eStatus === 'unclaimed') return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: 0, eStatus: bonus.eStatus };
            return { bonus, dUnlockAt: _.addMilliseconds(bonus.dCreatedDate, nDelayInMinutes * 60 * 1000), nCoins, nDelayInSec: Math.ceil(Math.max(new Date(bonus.dCreatedDate).getTime() + nDelayInMinutes * 60 * 1000 - Date.now(), 0) / 1000), eStatus: bonus.eStatus };
        };

        const { bonus, eStatus, nCoins, nDelayInSec } = await handleSpin(settings.nSpinWheelDelay || 0, nSpinBaseAmount, req.user._id, lastSpinWheel);
        if (eStatus === 'locked' && nDelayInSec) return res.reply(req.query?.eLocale === 'hi' ? message.noLocale(`${nDelayInSec} सेकंड तक प्रतीक्षा करें, फिलहाल यह क्लेम के लिए योग्य नहीं है`, 400) : message.noLocale(`Wait for ${nDelayInSec} sec as currently not eligible to claim`, 400));

        // claim when unclaimed
        bonus.eStatus = 'claimed';
        bonus.nCoins = nCoins;
        // apply VIP bonus for spin bonus
        {
            const vipBonusPercent = settings?.nVipBonusPercent || 0;
            let finalCoins = nCoins;
            if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
                finalCoins += Math.round((nCoins * vipBonusPercent) / 100);
            }
            log.info('VIP bonus check: Spin Wheel', {
                iUserId: req.user?._id?.toString?.() || req.user?._id,
                eUserType: req.user?.eUserType,
                baseReward: nCoins,
                vipBonusPercent,
                vipBonusAmount: finalCoins - nCoins,
                finalReward: finalCoins,
            });
            user.nTotalCoins += finalCoins;
        }
        // create new locked bonus
        const newBonus = new SpinBonus({ iUserId: req.user._id, nCoins: 0, dCreatedDate: new Date(), dUpdatedDate: new Date() });
        // set ttl
        await Promise.all([
            bonus.save(),
            user.save(),
            newBonus.save(),
            redis.setEx(_.getSpinBonusKey(req.user._id, newBonus._id), (settings.nSpinWheelDelay || 0) * 60, _.addMilliseconds(newBonus.dCreatedDate, (settings.nSpinWheelDelay || 0) * 60 * 1000)), //
        ]);
        return res.reply(message.successfully('Spin Bonus claimed', req.query?.eLocale || 'en'), { eStatus: 'claimed', nTotalCoins: user.nTotalCoins });
    } catch (error) {
        log.error('spinBonus failed ', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.updateName = (req, res) => {
    const body = _.pick(req.body, ['sUserName']);

    if (req.user.sUserName !== body.sUserName) {
        User.findOne({ sUserName: body.sUserName, _id: { $ne: req.user._id } }, (err, data) => {
            if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
            if (data) return res.reply(message.already_exists('User Name', req.query?.eLocale || 'en'));

            User.updateOne({ _id: req.user._id }, { $set: { sUserName: body.sUserName } }, (err) => {
                if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
                return res.reply(message.successfully('Updated', req.query?.eLocale || 'en'));
            });
        });
    }
};

controllers.updateAvatar = async (req, res) => {
    const updateQuery = {};
    let { sAvatar, oFile } = _.pick(req.body, ['sAvatar', 'oFile']); // ? body = {sAvatar: '', oFile: {name: '', base64: ''}}
    console.log('sAvatar', sAvatar);
    if (oFile) {
        try {
            oFile = _.parse(oFile);
            oFile.name = ['png', 'jpg', 'jpeg'].includes(oFile.name) ? oFile.name : 'png';
            console.log('oFile', { name: oFile.name, start: oFile.base64.slice(0, 50), end: oFile.base64.slice(-50) });
        } catch {
            return res.reply(message.server_error('', req.query?.eLocale || 'en'));
        }
    }
    if (sAvatar) {
        updateQuery.sAvatar = sAvatar;
    } else if (oFile && oFile.base64 && req.user.sUserName) {
        try {
            const { buffer } = _.base64ToBuffer(oFile.base64);
            const { Location } = await s3.upload(
                {
                    buffer,
                    name: oFile.name,
                    type: oFile.base64.split(';')[0].split('/')[1],
                },
                `${process.env.AWS_S3_FOLDER_PREFIX || ''}avatars/${req.user.sUserName}`
            );
            updateQuery.sAvatar = Location;
            console.log('s3 url', Location);
        } catch (e) {
            log.error(e);
        }
    } else {
        return res.reply(message.server_error());
    }
    User.findByIdAndUpdate({ _id: req.user._id }, updateQuery, (err) => {
        if (err) res.reply(message.server_error('', req.query?.eLocale || 'en'));
        return res.reply(message.successfully('Profile updated', req.query?.eLocale || 'en'), {
            sAvatar: updateQuery.sAvatar,
        });
    });
};

controllers.updatePassword = (req, res) => {
    const body = _.pick(req.body, ['sOldPassword', 'sNewPassword', 'sConfirmPassword']);

    if (!body.sOldPassword) return res.reply(message.required_field('Current password', req.query?.eLocale || 'en'));
    if (!body.sNewPassword) return res.reply(message.required_field('New password', req.query?.eLocale || 'en'));
    if (!body.sConfirmPassword) return res.reply(message.required_field('Confirm password', req.query?.eLocale || 'en'));

    const encryptedPassword = _.encryptPassword(body.sOldPassword);

    if (body.sNewPassword !== body.sConfirmPassword) return res.reply(message.not_matched('Password', req.query?.eLocale || 'en'));

    const query = { _id: req.user._id };

    User.findOne(query, (err, user) => {
        if (err) return res.reply(message.not_found('user'));
        if (user) {
            if (req.user.sPassword === encryptedPassword) {
                User.updateOne(query, { sPassword: _.encryptPassword(body.sNewPassword) }, (err) => {
                    if (err) return res.reply(message.server_error('', req.query?.eLocale || 'en'));
                    res.reply(message.successfully('Password changed', req.query?.eLocale || 'en'));
                });
            } else {
                res.reply(message.not_matched('Old password', req.query?.eLocale || 'en'));
            }
        }
    });
};

controllers.updateCoins = async (req, res) => {
    try {
        const body = _.pick(req.body, ['nCoins']);

        if (!body.nCoins) return res.reply(message.required_field('Coins', req.query?.eLocale || 'en'));
        body.nCoins = Number(body.nCoins);

        const user = await User.findOne({ _id: req.user._id });
        // apply VIP bonus for generic coin updates
        const settingsForUpdate = await Settings.findOne({}).lean();
        const vipBonusPercentForUpdate = settingsForUpdate?.nVipBonusPercent || 0;
        let finalCoinsToAdd = body.nCoins;
        if (req.user?.eUserType === 'vip' && vipBonusPercentForUpdate > 0 && body.nCoins > 0) {
            finalCoinsToAdd += Math.round((body.nCoins * vipBonusPercentForUpdate) / 100);
        }
        user.nTotalCoins += finalCoinsToAdd;
        await user.save();
        _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins, 10) });

        // Update earnCoins daily challenge if coins are earned (positive amount)
        if (body.nCoins > 0) {
            // Fire and forget - don't await to avoid blocking response
            (async () => {
                try {
                    const baseUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:3401' : process.env.BASE_URL;
                    await axios.post(
                        `${baseUrl}/api/v1/profile/daillyChallange/progress`,
                        {
                            eChallengeType: 'earnCoins',
                            nProgress: body.nCoins,
                        },
                        {
                            headers: {
                                Authorization: req.user.sToken,
                                authorization: req.user.sToken, // Some middleware expects lowercase
                            },
                            timeout: 4000,
                        }
                    );
                } catch (e) {
                    // Log error but don't fail the coin update
                    log.error('Failed to update earnCoins challenge in updateCoins:', e?.message || e);
                }
            })();
        }

        return res.reply(message.successfully('Coins updated', req.query?.eLocale || 'en'), { nTotalCoins: user.nTotalCoins });
    } catch (err) {
        log.red('updateCoins failed', err);
        return res.reply(message.server_error());
    }
};

controllers.updateSettings = async (req, res) => {
    try {
        const body = _.pick(req.body, ['bSoundEnabled', 'bVibrationEnabled', 'eLocale', 'nBackgroundId']);

        const [user, settings] = await Promise.all([
            User.findOne({ _id: req.user._id }),
            Settings.findOne().lean(), //
        ]);

        if (!user) return res.reply(message.not_found('user', req.query?.eLocale || 'en'));
        if (!settings) return res.reply(message.not_found('setting', req.query?.eLocale || 'en'));

        if (body.bSoundEnabled !== undefined) user.bSoundEnabled = body.bSoundEnabled;
        if (body.bVibrationEnabled !== undefined) user.bVibrationEnabled = body.bVibrationEnabled;
        if (body.eLocale && ['en', 'hi'].includes(body.eLocale)) user.eLocale = body.eLocale;
        body.nBackgroundId = parseInt(body.nBackgroundId);
        if (body.nBackgroundId && typeof body.nBackgroundId === 'number') {
            const oBackground = settings.aBackground.find((bg) => bg.nBackgroundId === body.nBackgroundId);
            if (!oBackground) return res.reply(message.not_found('background', req.query?.eLocale || 'en'));
            //
            if (!user.aUnlockedBackgroundIds || !user.aUnlockedBackgroundIds.length) user.aUnlockedBackgroundIds = [];
            //
            if (!user.aUnlockedBackgroundIds.includes(body.nBackgroundId)) {
                if (user.nTotalCoins < oBackground.nCost) return res.reply(message.insufficient('coins', req.query?.eLocale || 'en'));
                user.nTotalCoins -= oBackground.nCost;
                user.aUnlockedBackgroundIds.push(body.nBackgroundId);
            }
            user.nBackgroundId = body.nBackgroundId;
        }

        await user.save();
        return res.reply(message.successfully('Updated', req.query?.eLocale || 'en'), { eLocale: user.eLocale, bSoundEnabled: user.bSoundEnabled, bVibrationEnabled: user.bVibrationEnabled, nBackgroundId: user.nBackgroundId });
    } catch (error) {
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.deleteAccount = (req, res) => {
    User.deleteOne({ _id: req.user._id }, (error) => {
        if (error) return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
        res.reply(message.successfully('Account deleted', req.query?.eLocale || 'en'));
    });
};

controllers.updateDailyChallange = async (req, res) => {
    try {
        const body = _.pick(req.body, ['eChallengeType', 'nProgress']);
        if (!body.eChallengeType) return res.reply(message.required_field('eChallengeType', req.query?.eLocale || 'en'));

        if (!body.nProgress) return res.reply(message.required_field('nProgress', req.query?.eLocale || 'en'));

        const dailyChallenges = await DailyChallenge.find({ eChallengeType: body.eChallengeType, eStatus: 'y', isActive: true }).lean();
        if (!dailyChallenges.length) return res.reply(message.not_found('daily challenge', req.query?.eLocale || 'en'));

        const challengeIds = dailyChallenges.map((challenge) => challenge._id);

        const dailyChallangeUser = await DailyChallangeUser.find({
            iUserId: req.user._id,
            iDailyChallengeId: { $in: challengeIds },
        }).lean();

        // If no daily challenge user records found, return success without updating
        if (!dailyChallangeUser.length) {
            return res.reply(message.successfully('Daily challange updated', req.query?.eLocale || 'en'));
        }

        const updatableTypes = ['winMatch', 'playMatch', 'completeMatch', 'reachScore', 'earnCoins', 'spendCoins', 'winBig', 'dailyLogin', 'watchAds', 'playWithFriend'];

        // Update all matching challenges
        const updatePromises = [];
        for (const challange of dailyChallangeUser) {
            if (!updatableTypes.includes(challange.eChallengeType)) continue;

            const target = challange.nTarget || 1;

            if (['winBig', 'reachScore'].includes(challange.eChallengeType)) {
                const isCompleted = parseInt(body.nProgress, 10) >= target;
                // For 'winBig' and 'reachScore', also update nProgress and set isCompleted if progress >= target
                const progressToSet = parseInt(body.nProgress, 10) >= target ? target : parseInt(body.nProgress, 10);
                updatePromises.push(DailyChallangeUser.updateOne({ _id: challange._id }, { $set: { nProgress: progressToSet, isCompleted } }));
            } else {
                const currentProgress = challange.nProgress || 0;
                const addProgress = parseInt(body.nProgress, 10);
                let newProgress = currentProgress + addProgress;
                if (newProgress > target) newProgress = target;
                const isCompleted = newProgress >= target;

                updatePromises.push(DailyChallangeUser.updateOne({ _id: challange._id }, { $set: { nProgress: newProgress, isCompleted } }));
            }
        }

        // Execute all updates in parallel
        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
        }

        return res.reply(message.successfully('Daily challange updated', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('updateDailyChallange failed ', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'));
    }
};
// Update theme (theame) API controller
controllers.updateTheame = async (req, res) => {
    try {
        const body = _.pick(req.body, ['nTheamIndex']);
        if (typeof body.nTheamIndex === 'undefined' || body.nTheamIndex === null) {
            return res.reply(message.required_field('Theme index', req.query?.eLocale || 'en'));
        }

        // nTheamIndex should be a positive integer
        const nTheamIndex = parseInt(body.nTheamIndex, 10);
        if (isNaN(nTheamIndex) || nTheamIndex <= 0) { // eslint-disable-line no-restricted-globals
            return res.reply(message.invalid_field('Theme index', req.query?.eLocale || 'en'));
        }

        // Unlock the theme if not already unlocked
        const user = await User.findOne({ _id: req.user._id }, { aUnlockedBackgroundIds: 1, nTheamIndex: 1 });
        if (!user) return res.reply(message.not_found('user', req.query?.eLocale || 'en'));

        const update = { nTheamIndex };
        // Add to unlocked backgrounds list if not present
        if (!user.aUnlockedBackgroundIds.includes(nTheamIndex)) {
            update.aUnlockedBackgroundIds = [...user.aUnlockedBackgroundIds, nTheamIndex];
        }

        await User.updateOne({ _id: req.user._id }, { $set: update });
        return res.reply(message.successfully('Theme updated', req.query?.eLocale || 'en'));
    } catch (error) {
        log.error('updateTheame failed', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.getLoginStreakRewards = async (req, res) => {
    try {
        const [user, settings, claimedRewards] = await Promise.all([User.findOne({ _id: req.user._id }, { nLoginStreak: 1, dLAstStreakLoginAt: 1 }).lean(), Settings.findOne({}, { aLoginStreakRewards: 1 }).lean(), LoginStreakReward.find({ iUserId: req.user._id, eStatus: 'claimed' }, { iRewardId: 1 }).lean()]);

        if (!user) return res.reply(message.not_found('user', req.query?.eLocale || 'en'), {});
        if (!settings || !settings.aLoginStreakRewards || !settings.aLoginStreakRewards.length) {
            return res.reply(message.not_found('Login streak rewards', req.query?.eLocale || 'en'), {});
        }

        const currentStreak = user.nLoginStreak || 0;
        const claimedRewardIds = claimedRewards.map((r) => r.iRewardId?.toString() || r._id?.toString());

        const rewards = settings.aLoginStreakRewards.map((reward) => {
            const rewardId = reward._id?.toString();
            const isClaimed = claimedRewardIds.includes(rewardId);
            const isClaim = !isClaimed && currentStreak >= reward.nDay && currentStreak > 0;

            return {
                _id: reward._id,
                nDay: reward.nDay,
                nReward: reward.nReward,
                isClaim,
                isClaimed,
            };
        });

        return res.reply(message.successfully('', req.query?.eLocale || 'en'), {
            nLoginStreak: currentStreak,
            aLoginStreakRewards: rewards,
        });
    } catch (error) {
        log.error('getLoginStreakRewards failed ', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

controllers.claimLoginStreakReward = async (req, res) => {
    try {
        const body = _.pick(req.body, ['_id']);
        if (!body._id) return res.reply(message.required_field('Reward ID', req.query?.eLocale || 'en'));

        const [user, settings] = await Promise.all([User.findOne({ _id: req.user._id }, { nLoginStreak: 1, dLAstStreakLoginAt: 1, nTotalCoins: 1 }), Settings.findOne({}, { aLoginStreakRewards: 1, nVipBonusPercent: 1 }).lean()]);

        if (!user) return res.reply(message.not_found('user', req.query?.eLocale || 'en'), {});
        if (!settings || !settings.aLoginStreakRewards || !settings.aLoginStreakRewards.length) return res.reply(message.not_found('Login streak rewards', req.query?.eLocale || 'en'), {});

        // Find the reward by _id
        const rewardConfig = settings.aLoginStreakRewards.find((r) => r._id.toString() === body._id.toString());
        if (!rewardConfig) return res.reply(message.not_found('Reward', req.query?.eLocale || 'en'), {});

        // Check if already claimed by iRewardId
        const existingReward = await LoginStreakReward.findOne({ iUserId: req.user._id, iRewardId: body._id, eStatus: 'claimed' }).lean();
        if (existingReward) return res.reply(message.already_claimed('Reward', req.query?.eLocale || 'en'), {});

        // Check if user's streak is sufficient
        const currentStreak = user.nLoginStreak || 0;
        if (currentStreak < rewardConfig.nDay || currentStreak === 0) return res.reply(message.not_eligible_to_claim('reward', req.query?.eLocale || 'en'), {});

        // Create reward record and update user coins
        const reward = new LoginStreakReward({
            iUserId: req.user._id,
            iRewardId: rewardConfig._id,
            nDay: rewardConfig.nDay,
            nReward: rewardConfig.nReward,
            eStatus: 'claimed',
            timestamp: Date.now(),
        });

        // apply VIP bonus for login streak reward
        const vipBonusPercent = settings?.nVipBonusPercent || 0;
        let finalReward = rewardConfig.nReward;
        if (req.user?.eUserType === 'vip' && vipBonusPercent > 0) {
            finalReward += Math.round((rewardConfig.nReward * vipBonusPercent) / 100);
        }
        log.info('VIP bonus check: Login Streak', {
            iUserId: req.user?._id?.toString?.() || req.user?._id,
            eUserType: req.user?.eUserType,
            baseReward: rewardConfig.nReward,
            vipBonusPercent,
            vipBonusAmount: finalReward - rewardConfig.nReward,
            finalReward,
        });
        user.nTotalCoins += finalReward;
        await Promise.all([reward.save(), user.save()]);

        _.privateEmit(req.user._id, 'resUpdateCoins', { nTotalCoins: parseInt(user.nTotalCoins, 10) });

        return res.reply(message.successfully('Reward claimed', req.query?.eLocale || 'en'), {
            nTotalCoins: user.nTotalCoins,
            nReward: finalReward,
        });
    } catch (error) {
        log.error('claimLoginStreakReward failed ', error);
        return res.reply(message.server_error('', req.query?.eLocale || 'en'), error.toString());
    }
};

module.exports = controllers;
