```
set setting.iAchieverId for achieverId
```

```
TURN MANAGEMENT::
-----------------
p.declareCards() / p.forceDeclareCards()
    totalTurnCount = this.table.aPlayers.filter((p) => p.nTurnCount === 1 || p.bIsDroppedPlayer).length;
    totalTurnCount === this.table.nMaxPlayer
        ? table.declareResult()
        : nextPlayer.takeTurn()


p.takeTurn()
    p.nTurnCount += 1;

p.resetRound();
        this.nTurnCount = 0;
        this.nMissedTurn = 0;
        this.aDeclaredHand = [];

t.declareResult()
    this.nTableRound < this.nTotalRound - 1
        ? t.resetTable()
        : t.declareWinner() // finalWinner. GameEnd here

t.resetTable()
    for (const p of t.aPlayers) p.resetRound();

t.startRound()
        t.deleteScheduler('turnTimer-assignSetHandTime');
        { nMaxWaitingTime } = this.oSetting;
        t.state = 'declaring';
        t.setSchedular('turnTimer-assignSkippedTime', null, nMaxWaitingTime, { nMaxWaitingTime, expiredAt: Date.now() + nMaxWaitingTime });
        t.emit('resRoundStartsIn', { ttl: nMaxWaitingTime, initialValue: 0, nTotalTurnTime: nMaxWaitingTime });
        t.save();

t.startTurn()




takeTurn call site [
    declareCards(body, callback = () => {})
    forceDeclareCards(body, callback = () => {})
    dropPlayer()
    skipTurn(nSeat)
]
```

TIMERS:

```
assignRoundTime
    : nothing

assignTurnTime
    : player.assignTurnTime()

grabTimer
    : table.forceGrabCard();
        : table.setHandTimer()
            {
                if (this.eState !== 'initializing') return false;
                const { nInitialTimer } = this.oSetting; // time to arrange card
                this.eState = 'initialized';
                this.setSchedular('turnTimer-assignSetHandTime', null, nInitialTimer, { nInitialTimer, expiredAt: Date.now() + nInitialTimer });
                this.emit('resSetHandTimer', { ttl: nInitialTimer, initialValue: 0, nTotalTurnTime: nInitialTimer });
                this.save({ eState: this.eState, aPlayers: this.aPlayers.map((p) => p.toJSON()) });
            }
assignSetHandTime
    // nInitialTimer // used for card arrange timer
    : t.startTurn()

assignSkippedTime
    // nMaxWaitingTime // used when all player clicked on ready button to skip setHandTimer
    : t.startTurn()
```

ERRORS:

```
updatedWinner not found
TypeError: Cannot set property 'nGroupId' of undefined
    at leaveOnDeclaring (/home/ubuntu/Desktop/projects/sewali-charwali-game-backend/app/TableManager/Players/index.js:287:48)
    at runMicrotasks (<anonymous>)
    at processTicksAndRejections (internal/process/task_queues.js:95:5)
TypeError: Cannot set property 'nGroupId' of undefined
    at leaveOnDeclaring (/home/ubuntu/Desktop/projects/sewali-charwali-game-backend/app/TableManager/Players/index.js:287:48)
    at runMicrotasks (<anonymous>)
    at processTicksAndRejections (internal/process/task_queues.js:95:5)
TypeError: Cannot read property 'iUserId' of undefined
    at SewaliTable.declareResult (/home/ubuntu/Desktop/projects/sewali-charwali-game-backend/app/TableManager/Table/SewaliTable.js:165:33)
    at runMicrotasks (<anonymous>)
    at processTicksAndRejections (internal/process/task_queues.js:95:5)
TypeError: Cannot read property 'iUserId' of undefined
    at SewaliTable.declareResult (/home/ubuntu/Desktop/projects/sewali-charwali-game-backend/app/TableManager/Table/SewaliTable.js:165:33)
    at runMicrotasks (<anonymous>)
    at processTicksAndRejections (internal/process/task_queues.js:95:5)

```
