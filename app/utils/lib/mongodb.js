/* eslint-disable new-cap */
const mongoose = require('mongoose');

function MongoClient() {
    this.options = {
        useUnifiedTopology: true,
        useNewUrlParser: true,
        useCreateIndex: true,
        useFindAndModify: false,
    };
}

MongoClient.prototype.initialize = function () {
    mongoose
        .connect(process.env.DB_URL, this.options)
        .then(() => log.yellow('Database connected'))
        .catch((error) => {
            throw error;
        });
};

MongoClient.prototype.mongify = function (id) {
    return mongoose.Types.ObjectId(id);
};

MongoClient.prototype.isValidObjectId = function (id) {
    return mongoose.isValidObjectId(id);
};

module.exports = new MongoClient();
