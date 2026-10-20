function SewaliHand(aHand = []) {
    this.aHand = aHand;
}

const aSuitOrder = ['s', 'd', 'c', 'h'];
let _aHand;
SewaliHand.prototype.validate = function () {
    _aHand = _.deepClone(this.aHand);
    const aceCount = _aHand.filter((c) => c.nLabel === 1).length || 0;
    const aceScore = {
        0: 0,
        1: 60,
        2: 30,
        3: 30,
    };
    _aHand.map((p) => {
        if (p.nLabel === 1) p.nLabel = aceScore[aceCount];
        // if (p.nLabel === 1) p.nLabel = 100;
        return null;
    });
    _aHand = _aHand.sort((a, b) => a.nLabel - b.nLabel);
    const response = this._validate();
    return { nScore: response.nScore, nRank: response.nRank, nPriority: response.nPriority };
};

SewaliHand.prototype._validate = function () {
    let response;

    response = this.isSet();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 1 };

    response = this.isPure235();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 2 };

    response = this.isPureSequence();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 3 };

    response = this.isImpure235();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 4 };

    response = this.isImpureSequence();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 5 };

    response = this.isColor();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 6 };

    response = this.isPair();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 7 };

    response = this.isHighCard();
    if (response.isValid) return { nScore: response.nScore, nRank: response.nRank, nPriority: 8 };
};

SewaliHand.prototype.isSet = function () {
    const isValid = _aHand.every((p) => p.nLabel === _aHand[0].nLabel);
    if (isValid) return { isValid: true, nScore: _aHand[0].nLabel * 3, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) }; // - nRank: aSuitOrder.indexOf(_aHand[0].eSuit) // previously :: nRank : 0
    return { isValid: false };
};

SewaliHand.prototype.isPure235 = function () {
    const impure235 = this.isImpure235();
    const color = this.isColor();
    if (impure235.isValid && color.isValid) return { isValid: true, nScore: impure235.nScore, nRank: impure235.nRank };
    return { isValid: false };
};

SewaliHand.prototype.isImpure235 = function () {
    const nScore = _aHand[2].nLabel + _aHand[1].nLabel + _aHand[0].nLabel;
    const isValid = _aHand[0].nLabel === 2 && _aHand[1].nLabel === 3 && _aHand[2].nLabel === 5;
    if (isValid) return { isValid: true, nScore, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) };
    return { isValid: false };
};

SewaliHand.prototype.isPureSequence = function () {
    const impureSeq = this.isImpureSequence();
    const color = this.isColor();
    if (impureSeq.isValid && color.isValid) return { isValid: true, nScore: impureSeq.nScore, nRank: impureSeq.nRank };
    return { isValid: false };
};

SewaliHand.prototype.isImpureSequence = function () {
    const nScore = _aHand[2].nLabel + _aHand[1].nLabel + _aHand[0].nLabel;
    if (_aHand[0].nLabel + 2 === _aHand[1].nLabel && _aHand[1].nLabel + 1 === _aHand[2].nLabel) return { isValid: true, nScore, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) };
    if (_aHand[0].nLabel === 12 && _aHand[1].nLabel === 13 && _aHand[2].nLabel === 100) return { isValid: true, nScore, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) };
    if (_aHand[0].nLabel === 2 && _aHand[1].nLabel === 3 && _aHand[2].nLabel === 100) return { isValid: true, nScore, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) };
    return { isValid: false };
};

SewaliHand.prototype.isColor = function () {
    const isValid = _aHand.every((c) => c.eSuit === _aHand[0].eSuit);
    const nScore = _aHand[2].nLabel + _aHand[1].nLabel + _aHand[0].nLabel;
    if (isValid) return { isValid: true, nScore, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) };
    return { isValid: false };
};

SewaliHand.prototype.isPair = function () {
    for (let i = 0; i < _aHand.length; i += 1) {
        let c = i + 1;
        if (c >= _aHand.length) c = 0;
        const pair1 = aSuitOrder.indexOf(_aHand[i].eSuit);
        const pair2 = aSuitOrder.indexOf(_aHand[c].eSuit);
        if (_aHand[i].nLabel === _aHand[c].nLabel) return { isValid: true, nScore: _aHand[2].nLabel + _aHand[1].nLabel + _aHand[0].nLabel, nRank: Math.min(pair1, pair2) };
    }
    return { isValid: false };
};

SewaliHand.prototype.isHighCard = function () {
    const nScore = _aHand[2].nLabel + _aHand[1].nLabel + _aHand[0].nLabel;
    return { isValid: true, nScore, nRank: aSuitOrder.indexOf(_aHand[2].eSuit) };
};

module.exports = SewaliHand;
