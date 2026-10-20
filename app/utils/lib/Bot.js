/* eslint-disable no-plusplus */
/* eslint-disable no-sparse-arrays */
// const _ = require('../../../globals/lib/helper');

class Bot {
    aCards = [];

    constructor(aCards, nCount) {
        this.aSuitOrder = ['s', 'd', 'c', 'h'];
        this.aCardOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
        this.aMatrix = [
            [, , , , , , , , , , , , , ,],
            [, , , , , , , , , , , , , ,],
            [, , , , , , , , , , , , , ,],
            [, , , , , , , , , , , , , ,],
        ];
        this.aCards = aCards;
        this.aPair = [];
        this.oPair = {
            aPure235: [],
            aImpure235: [],
            aSet: [],
            aStraight: [],
            aNormal: [],
            aColor: [],
            aPair: [],
            aHighCard: [],
        };
        this.nCount = nCount;
        this.bestGroup = [];
        this.generateMatrix();
    }

    generateMatrix() {
        for (const card of this.aCards) {
            const suitIndex = this.aSuitOrder.indexOf(card.eSuit);
            const cardIndex = card.nLabel - 1;
            if (cardIndex === 0) this.aMatrix[suitIndex][13] = card;
            this.aMatrix[suitIndex][cardIndex] = card;
        }
    }

    getPure235() {
        const _aPair = [];
        for (let suitIndex = 0; suitIndex <= 3; suitIndex++) {
            if (this.aMatrix[suitIndex][1] && this.aMatrix[suitIndex][2] && this.aMatrix[suitIndex][4]) {
                _aPair.push([this.aMatrix[suitIndex][1], this.aMatrix[suitIndex][2], this.aMatrix[suitIndex][4]]);
                delete this.aMatrix[suitIndex][1];
                delete this.aMatrix[suitIndex][2];
                delete this.aMatrix[suitIndex][4];
            }
        }
        if (_aPair.length) this.oPair.aPure235.push(..._aPair);
    }

    getImpure235() {
        const aTwo = []; // cardIndex-1
        const aThree = []; // cardIndex-2
        const aFive = []; // cardIndex-4
        const _aPair = [];
        for (let cardIndex = 1; cardIndex <= 4; cardIndex++) {
            for (let suitIndex = 0; suitIndex <= 3; suitIndex++) {
                switch (cardIndex) {
                    case 1:
                        if (this.aMatrix[suitIndex][cardIndex]) aTwo.push(this.aMatrix[suitIndex][cardIndex]);
                        break;
                    case 2:
                        if (this.aMatrix[suitIndex][cardIndex]) aThree.push(this.aMatrix[suitIndex][cardIndex]);
                        break;
                    case 4:
                        if (this.aMatrix[suitIndex][cardIndex]) aFive.push(this.aMatrix[suitIndex][cardIndex]);
                        break;
                    default:
                        break;
                }
            }
            if (cardIndex === 2) cardIndex += 1;
        }
        while (aTwo.length && aThree.length && aFive.length) {
            const oTwo = aTwo.splice(0, 1)[0];
            const oThree = aThree.splice(0, 1)[0];
            const oFive = aFive.splice(0, 1)[0];
            _aPair.push([oTwo, oThree, oFive]);
            delete this.aMatrix[this.aSuitOrder.indexOf(oTwo.eSuit)][oTwo.nLabel - 1];
            delete this.aMatrix[this.aSuitOrder.indexOf(oThree.eSuit)][oThree.nLabel - 1];
            delete this.aMatrix[this.aSuitOrder.indexOf(oFive.eSuit)][oFive.nLabel - 1];
        }
        if (_aPair.length) this.oPair.aImpure235.push(..._aPair);
        // TODO sorting
    }

    getSet() {
        const _aPair = [];
        const deletionRecord = {};
        for (let cardIndex = 13; cardIndex >= 1; cardIndex--) {
            const pair = [];
            for (let suitIndex = 0; suitIndex <= 3 && pair.length < 3; suitIndex++) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    pair.push(this.aMatrix[suitIndex][cardIndex]);
                    deletionRecord[`${suitIndex}-${cardIndex}`] = this.aMatrix[suitIndex][cardIndex];
                    delete this.aMatrix[suitIndex][cardIndex];
                    if (cardIndex === 13) {
                        deletionRecord[`${suitIndex}-${0}`] = this.aMatrix[suitIndex][0];
                        delete this.aMatrix[suitIndex][0];
                    }
                }
            }
            if (pair.length === 3) {
                _aPair.push([...pair]);
                for (const [key, val] of Object.entries(deletionRecord)) {
                    delete deletionRecord[key];
                }
                pair.length = 0;
            } else {
                for (const [key, val] of Object.entries(deletionRecord)) {
                    const [_suitIndex, _cardIndex] = key.split('-').map((e) => Number(e));
                    this.aMatrix[_suitIndex][_cardIndex] = val;
                    delete deletionRecord[key];
                }
            }
        }
        // _aPair = this.sortCard(_aPair);
        this.oPair.aSet.push(..._aPair);
    }

    getStraight() {
        let _aPair = [];
        for (let suitIndex = 0; suitIndex <= 3; suitIndex++) {
            for (let cardIndex = 13; cardIndex >= 2; cardIndex--) {
                if (this.aMatrix[suitIndex][cardIndex] && this.aMatrix[suitIndex][cardIndex - 1] && this.aMatrix[suitIndex][cardIndex - 2]) {
                    _aPair.push([this.aMatrix[suitIndex][cardIndex], this.aMatrix[suitIndex][cardIndex - 1], this.aMatrix[suitIndex][cardIndex - 2]]);
                    delete this.aMatrix[suitIndex][cardIndex];
                    delete this.aMatrix[suitIndex][cardIndex - 1];
                    delete this.aMatrix[suitIndex][cardIndex - 2];
                    if (cardIndex === 13) delete this.aMatrix[suitIndex][0];
                    else if (cardIndex - 2 === 0) delete this.aMatrix[suitIndex][13];
                }
            }
        }
        _aPair = this.sortCard(_aPair);
        this.oPair.aStraight.push(..._aPair);
    }

    getNormal() {
        let prevPairSizeFirst = 0;
        let prevPairSizeSecond = 0;
        let _aPair = [];
        const pair1 = [];
        const pair2 = [];
        const deletionRecord1 = {};
        const deletionRecord2 = {};
        for (let cardIndex = 13; cardIndex >= 0; cardIndex--) {
            for (let suitIndex = 0; suitIndex <= 3 && pair1.length < 3; suitIndex++) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    pair1.push(this.aMatrix[suitIndex][cardIndex]);
                    deletionRecord1[`${suitIndex}-${cardIndex}`] = this.aMatrix[suitIndex][cardIndex];
                    delete this.aMatrix[suitIndex][cardIndex];
                    if (cardIndex === 13) {
                        deletionRecord1[`${suitIndex}-${0}`] = this.aMatrix[suitIndex][0];
                        delete this.aMatrix[suitIndex][0];
                    }
                    break;
                }
            }
            if (pair1.length === 3) {
                _aPair.push([...pair1]);
                for (const [key, val] of Object.entries(deletionRecord1)) delete deletionRecord1[key];
                pair1.length = 0;
            } else if (prevPairSizeFirst && prevPairSizeFirst !== pair1.length - 1) {
                // restore deleted card;
                for (const [key, val] of Object.entries(deletionRecord1)) {
                    const [_suitIndex, _cardIndex] = key.split('-').map((e) => Number(e));
                    this.aMatrix[_suitIndex][_cardIndex] = val;
                    delete deletionRecord1[key];
                }
                pair1.length = 0;
            }
            prevPairSizeFirst = pair1.length;
            for (let suitIndex = 0; suitIndex <= 3 && pair2.length < 3; suitIndex++) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    pair2.push(this.aMatrix[suitIndex][cardIndex]);
                    deletionRecord2[`${suitIndex}-${cardIndex}`] = this.aMatrix[suitIndex][cardIndex];
                    delete this.aMatrix[suitIndex][cardIndex];
                    if (cardIndex === 13) {
                        deletionRecord2[`${suitIndex}-${0}`] = this.aMatrix[suitIndex][0];
                        delete this.aMatrix[suitIndex][0];
                    }
                    break;
                }
            }
            if (pair2.length === 3) {
                _aPair.push([...pair2]);
                for (const [key, val] of Object.entries(deletionRecord2)) delete deletionRecord2[key];
                pair2.length = 0;
            } else if (prevPairSizeSecond && prevPairSizeSecond !== pair2.length - 1) {
                // restore deleted card;
                for (const [key, val] of Object.entries(deletionRecord2)) {
                    const [_suitIndex, _cardIndex] = key.split('-').map((e) => Number(e));
                    this.aMatrix[_suitIndex][_cardIndex] = val;
                    delete deletionRecord2[key];
                }
                pair2.length = 0;
            }
            prevPairSizeSecond = pair2.length;
        }
        _aPair = this.sortCard(_aPair);
        this.oPair.aNormal.push(..._aPair);
    }

    getColor() {
        let _aPair = [];
        const deletionRecord = {};
        for (let suitIndex = 0; suitIndex <= 3; suitIndex++) {
            const pair = [];
            for (let cardIndex = 13; cardIndex >= 1; cardIndex--) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    pair.push(this.aMatrix[suitIndex][cardIndex]);
                    deletionRecord[`${suitIndex}-${cardIndex}`] = this.aMatrix[suitIndex][cardIndex];
                    delete this.aMatrix[suitIndex][cardIndex];
                    if (cardIndex === 13) {
                        deletionRecord[`${suitIndex}-${0}`] = this.aMatrix[suitIndex][0];
                        delete this.aMatrix[suitIndex][0];
                    }
                    if (pair.length === 3) {
                        _aPair.push([...pair]);
                        for (const [key, val] of Object.entries(deletionRecord)) delete deletionRecord[key];
                        pair.length = 0;
                    }
                }
            }
            if (pair.length !== 3) {
                for (const [key, val] of Object.entries(deletionRecord)) {
                    const [_suitIndex, _cardIndex] = key.split('-').map((e) => Number(e));
                    this.aMatrix[_suitIndex][_cardIndex] = val;
                    delete deletionRecord[key];
                }
            }
        }
        _aPair = this.sortCard(_aPair);
        this.oPair.aColor.push(..._aPair);
    }

    getPair() {
        let _aPair = [];
        const deletionRecord = {};
        // first get 2 card
        for (let cardIndex = 13; cardIndex >= 1; cardIndex--) {
            const pair = [];
            for (let suitIndex = 0; suitIndex <= 3 && pair.length < 2; suitIndex++) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    pair.push(this.aMatrix[suitIndex][cardIndex]);
                    deletionRecord[`${suitIndex}-${cardIndex}`] = this.aMatrix[suitIndex][cardIndex];
                    delete this.aMatrix[suitIndex][cardIndex];
                    if (cardIndex === 13) {
                        deletionRecord[`${suitIndex}-${0}`] = this.aMatrix[suitIndex][0];
                        delete this.aMatrix[suitIndex][0];
                    }
                }
            }
            if (pair.length === 2) {
                _aPair.push([...pair]);
                for (const [key, val] of Object.entries(deletionRecord)) delete deletionRecord[key];
            } else {
                for (const [key, val] of Object.entries(deletionRecord)) {
                    const [_suitIndex, _cardIndex] = key.split('-').map((e) => Number(e));
                    this.aMatrix[_suitIndex][_cardIndex] = val;
                    delete deletionRecord[key];
                }
            }
        }
        // add third card to each pair.
        const sortedCards = [];
        for (let suitIndex = 0; suitIndex <= 3; suitIndex++) {
            for (let cardIndex = 13; cardIndex >= 1; cardIndex--) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    sortedCards.push({ [`${suitIndex}-${cardIndex}`]: this.aMatrix[suitIndex][cardIndex] });
                }
            }
        }
        while (_aPair.length > sortedCards.length) {
            const [first, second] = _aPair.splice(-1)[0]; // = [{}, {}]
            sortedCards.push({ [`${this.aSuitOrder.indexOf(first.eSuit)}-${first.nLabel - 1}`]: first });
            sortedCards.push({ [`${this.aSuitOrder.indexOf(second.eSuit)}-${second.nLabel - 1}`]: second });
            this.aMatrix[this.aSuitOrder.indexOf(first.eSuit)][first.nLabel - 1] = first;
            this.aMatrix[this.aSuitOrder.indexOf(second.eSuit)][second.nLabel - 1] = second;
        }
        for (let i = 0, j = 0; i < _aPair.length; i++) {
            _aPair[i].push(Object.values(sortedCards[j])[0]);
            const [_suitIndex, _cardIndex] = Object.keys(sortedCards[j])[0]
                .split('-')
                .map((e) => Number(e));
            delete this.aMatrix[_suitIndex][_cardIndex];
            if (_cardIndex === 13) delete this.aMatrix[_suitIndex][0]; // suitIndex
            j += 1;
        }
        _aPair = this.sortCard(_aPair);
        this.oPair.aPair.push(..._aPair);
    }

    getHighCard() {
        // any 3 card that doesnt belong to other category
        let _aPair = [];
        const pair = [];
        for (let cardIndex = 13; cardIndex >= 1; cardIndex--) {
            for (let suitIndex = 0; suitIndex <= 3; suitIndex++) {
                if (this.aMatrix[suitIndex][cardIndex]) {
                    pair.push(this.aMatrix[suitIndex][cardIndex]);
                    delete this.aMatrix[suitIndex][cardIndex];
                    if (cardIndex === 13) delete this.aMatrix[suitIndex][0];
                    if (pair.length === 3) {
                        _aPair.push([...pair]);
                        pair.length = 0;
                    }
                }
            }
        }
        if (pair.length === 3) _aPair.push([...pair]);
        if (pair.length < 3) {
            for (const card of pair) {
                this.aMatrix[this.aSuitOrder.indexOf(card.eSuit)][card.nLabel - 1] = card;
                if (card.nLabel === 1) this.aMatrix[this.aSuitOrder.indexOf(card.eSuit)][0] = card;
            }
        }
        _aPair = this.sortCard(_aPair);
        this.oPair.aHighCard.push(..._aPair);
    }

    // eslint-disable-next-line class-methods-use-this
    sortCard(pairs) {
        const _aPair = _.deepClone(pairs);
        _aPair.map((card) => {
            if (card.nLabel === 1) card.nLabel = 100;
            return null;
        });
        _aPair.map((pair) =>
            pair.map((card) => {
                if (card.nLabel === 1) card.nLabel = 100;
                return null;
            })
        );
        // eslint-disable-next-line prettier/prettier
        _aPair.sort( (a,b) =>  (b[0].nLabel + b[1].nLabel + b[2].nLabel) -  (a[0].nLabel + a[1].nLabel + a[2].nLabel) )
        _aPair.map((pair) =>
            pair.map((card) => {
                if (card.nLabel === 100) card.nLabel = 1;
                return null;
            })
        );
        return _aPair;
    }

    // getBestGroup() {
    //     this.getPure235();
    //     this.getImpure235(); // TODO sorting
    //     this.getSet();
    //     this.getStraight();
    //     this.getNormal();
    //     this.getColor();
    //     this.getPair();
    //     this.getHighCard();
    //     // const _aPair = _.deepClone(this.aPair);
    //     // for (const pair of _aPair) {
    //     //     if (this.nCount--) this.bestGroup.push(pair);
    //     //     else break;
    //     // }
    //     // return this.bestGroup;
    //     return this.oPair;
    // }
    getBestGroup() {
        this.getSet(); // 3 card with same label
        this.getPure235(); // 2,3,5 of same suit
        this.getStraight(); // 3 card with consecutive label of same suit
        this.getImpure235(); // 2,3,5 of different suit
        this.getNormal(); // 3 card with consecutive label of different suit
        this.getColor(); // 3 card with same suit(s,d,c,h)
        this.getPair(); // 2 card with same label
        this.getHighCard(); // any 3 card that doesn't belong to other category
        return this.oPair;
    }
}

module.exports = Bot;
