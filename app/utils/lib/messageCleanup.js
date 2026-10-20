const { Message } = require('../../models');

/**
 * Cleanup messages older than 30 days
 * This function deletes messages that are older than 30 days
 */
async function cleanupOldMessages() {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await Message.deleteMany({
            dCreatedDate: { $lt: thirtyDaysAgo },
        });

        log.blue(`Message cleanup: Deleted ${result.deletedCount} messages older than 30 days`);
        return result.deletedCount;
    } catch (error) {
        log.error('Message cleanup error:', error);
        return 0;
    }
}

/**
 * Initialize message cleanup job
 * Runs cleanup once on startup and then every 24 hours
 */
function initializeCleanup() {
    // Run cleanup immediately on startup
    cleanupOldMessages().catch((err) => {
        log.error('Initial message cleanup failed:', err);
    });

    // Run cleanup every 24 hours (86400000 ms)
    const cleanupInterval = setInterval(() => {
        cleanupOldMessages().catch((err) => {
            log.error('Scheduled message cleanup failed:', err);
        });
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Store interval reference for potential cleanup on shutdown
    if (globalThis.messageCleanupInterval) {
        clearInterval(globalThis.messageCleanupInterval);
    }
    globalThis.messageCleanupInterval = cleanupInterval;

    log.green('Message cleanup job initialized - will run every 24 hours');
}

module.exports = {
    cleanupOldMessages,
    initializeCleanup,
};
