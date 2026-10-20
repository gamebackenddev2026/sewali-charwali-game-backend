/**
 * Represents a playing card.
 * @typedef {Object} Card
 * @property {string} _id - The unique identifier for the card eSuit + nLabel (e.g., 'c1' for the Ace of Clubs).
 * @property {1|2|3|4|5|6|7|8|9|10|11|12|13} nLabel - The numeric label of the card (e.g., 1 for Ace, 2 for Two, etc.).
 * @property {2|3|4|5|6|7|8|9|10} nValue - The assigned value of the card in a card game (e.g., 10 for a 10 of Clubs).
 * @property {'s'|'d'|'c'|'h'} eSuit - The suit of the card (e.g., 'c' for Clubs).
 * @property {false} isJoker - Indicates whether the card is a Joker (true) or not (false).
 */

/** @type {Omit<Card, '_id'>[]} */
const clubs = [
    {
        nLabel: 1,
        nValue: 10,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 2,
        nValue: 2,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 3,
        nValue: 3,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 4,
        nValue: 4,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 5,
        nValue: 5,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 6,
        nValue: 6,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 7,
        nValue: 7,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 8,
        nValue: 8,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 9,
        nValue: 9,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 10,
        nValue: 10,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 11,
        nValue: 10,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 12,
        nValue: 10,
        eSuit: 'c',
        isJoker: false,
    },
    {
        nLabel: 13,
        nValue: 10,
        eSuit: 'c',
        isJoker: false,
    },
];

/** @type {Omit<Card, '_id'>[]} */
const spades = [
    {
        nLabel: 1,
        nValue: 10,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 2,
        nValue: 2,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 3,
        nValue: 3,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 4,
        nValue: 4,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 5,
        nValue: 5,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 6,
        nValue: 6,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 7,
        nValue: 7,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 8,
        nValue: 8,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 9,
        nValue: 9,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 10,
        nValue: 10,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 11,
        nValue: 10,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 12,
        nValue: 10,
        eSuit: 's',
        isJoker: false,
    },
    {
        nLabel: 13,
        nValue: 10,
        eSuit: 's',
        isJoker: false,
    },
];

/** @type {Omit<Card, '_id'>[]} */
const diamonds = [
    {
        nLabel: 1,
        nValue: 10,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 2,
        nValue: 2,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 3,
        nValue: 3,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 4,
        nValue: 4,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 5,
        nValue: 5,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 6,
        nValue: 6,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 7,
        nValue: 7,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 8,
        nValue: 8,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 9,
        nValue: 9,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 10,
        nValue: 10,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 11,
        nValue: 10,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 12,
        nValue: 10,
        eSuit: 'd',
        isJoker: false,
    },
    {
        nLabel: 13,
        nValue: 10,
        eSuit: 'd',
        isJoker: false,
    },
];

/** @type {Omit<Card, '_id'>[]} */
const heart = [
    {
        nLabel: 1,
        nValue: 10,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 2,
        nValue: 2,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 3,
        nValue: 3,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 4,
        nValue: 4,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 5,
        nValue: 5,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 6,
        nValue: 6,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 7,
        nValue: 7,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 8,
        nValue: 8,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 9,
        nValue: 9,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 10,
        nValue: 10,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 11,
        nValue: 10,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 12,
        nValue: 10,
        eSuit: 'h',
        isJoker: false,
    },
    {
        nLabel: 13,
        nValue: 10,
        eSuit: 'h',
        isJoker: false,
    },
];

const jokers = [
    {
        nLabel: 14,
        nValue: 0,
        eSuit: 'j',
        isJoker: true,
    },
];

/** @type {Omit<Card, '_id'>[]} */
const aPureDeck = [
    //
    ...clubs,
    ...spades,
    ...diamonds,
    ...heart,
];

const aDeck = [
    //
    ...aPureDeck,
    ...jokers,
];

const operation = {};
const inTestingShuffle = false;
const inTestingQuads = false;

operation.getPureDeck = (nDeck) => {
    let deck = [];
    for (let i = 0; i < nDeck; i += 1) {
        for (let j = 0; j < aPureDeck.length; j += 1) {
            deck.push({ ...aPureDeck[j], _id: `${aPureDeck[j].eSuit}${aPureDeck[j].nLabel}` });
        }
    }

    if (inTestingQuads) {
        deck = _.randomizeArray(deck);
        let counter = 0;
        for (let i = 0; i < 17; i += 1) {
            if (deck[i].nLabel === 2 || deck[i].nLabel === 10) {
                while (deck[17 + counter].nLabel === 2 || deck[17 + counter].nLabel === 10) {
                    counter += 1;
                }
                const obj = deck[i];
                deck[i] = deck[17 + counter];
                deck[17 + counter] = obj;
            }
        }
        for (let i = 0; i < 8; i += 4) {
            const obj = deck.filter((c) => c.nLabel === deck[i].nLabel && c.eSuit !== deck[i].eSuit); // eslint-disable-line no-loop-func
            for (let j = 1; j < 4; j += 1) {
                const index = deck.findIndex((p) => p.nLabel === obj[j - 1].nLabel && p.eSuit === obj[j - 1].eSuit); // eslint-disable-line no-loop-func
                deck[index] = deck[i + j];
                deck[j + i] = obj[j - 1];
            }
        }
        return deck;
    }

    if (inTestingShuffle) {
        let counter = 0;
        deck = _.randomizeArray(deck);
        for (let i = 0; i < 17; i += 1) {
            if (deck[i].nLabel === 2 || deck[i].nLabel === 10) {
                while (deck[17 + counter].nLabel === 2 || deck[17 + counter].nLabel === 10) {
                    counter += 1;
                }
                const obj = deck[i];
                deck[i] = deck[17 + counter];
                deck[17 + counter] = obj;
            }
        }
        for (let i = 0; i < 16; i += 2) {
            counter = 1;
            while (deck[i + counter].nLabel !== deck[i].nLabel) {
                counter += 1;
            }
            const obj = deck[i + counter];
            const index = deck.findIndex((p) => p.nLabel === obj.nLabel && p.eSuit === obj.eSuit); // eslint-disable-line no-loop-func
            deck[index] = deck[i + 1];
            deck[i + 1] = obj;
        }
        return deck;
    }
    // deck = _.randomizeArray(deck);
    // const twoDCard = deck.findIndex((c) => c.nLabel === 2 && c.eSuit === 'd');
    // const temp = deck[0];
    // deck[0] = deck[twoDCard];
    // deck[twoDCard] = temp;
    return _.randomizeArray(_.randomizeArray(deck));
};

operation.getRandomCards = (nCards) => {
    const cards = operation.getPureDeck();
    const aRandomCards = [];

    while (aRandomCards.length < nCards && cards.length) {
        const randomIndex = _.randomBetween(0, cards.length - 1);
        const card = { ...cards.splice(randomIndex, 1)[0], _id: aRandomCards.length };
        aRandomCards.push(card);
    }
    return aRandomCards;
};

operation.getHighCards = (nCards) => {
    const cards = operation.getPureDeck();
    const response = {
        aRandomCards: [],
        iMaxCardIndex: 0,
    };

    while (response.aRandomCards.length < nCards && cards.length) {
        const randomIndex = _.randomBetween(0, cards.length - 1);
        const currentIndex = response.aRandomCards.length;
        const previousCardPriority = response.aRandomCards[response.iMaxCardIndex] ? response.aRandomCards[response.iMaxCardIndex].nPriority : 0;
        const card = { ...cards.splice(randomIndex, 1)[0], _id: currentIndex, isHigh: false };

        card.nPriority = card.nLabel === 1 ? 13 : card.nLabel;

        if (card.nPriority > previousCardPriority) response.iMaxCardIndex = currentIndex; // to get current cards index.
        response.aRandomCards.push(card);
    }

    if (response.aRandomCards[response.iMaxCardIndex]) response.aRandomCards[response.iMaxCardIndex].isHigh = true;

    return response;
};

operation.getDeck = (nDeck) => {
    const deck = [];
    for (let i = 0; i < nDeck; i += 1) {
        for (let j = 0; j < aDeck.length; j += 1) {
            deck.push({ ...aDeck[j], _id: `${aPureDeck[j].eSuit}${aPureDeck[j].nLabel}` });
        }
    }
    return _.randomizeArray(_.randomizeArray(deck));
};

module.exports = operation;

// console.log(operation.getDeck(2).length);
