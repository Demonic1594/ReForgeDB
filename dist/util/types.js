"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoCooldown = exports.MongoRecord = exports.SQLCooldown = exports.Cooldown = exports.SQLiteRecord = exports.PostgreSQLRecord = exports.MySQLRecordWithoutIndex = exports.MySQLRecord = exports.VariableType = exports.DataType = exports.SortType = void 0;
exports.driverKind = driverKind;
const typeorm_1 = require("typeorm");
var SortType;
(function (SortType) {
    SortType[SortType["asc"] = 0] = "asc";
    SortType[SortType["desc"] = 1] = "desc";
})(SortType || (exports.SortType = SortType = {}));
var DataType;
(function (DataType) {
    DataType[DataType["identifier"] = 0] = "identifier";
    DataType[DataType["name"] = 1] = "name";
    DataType[DataType["id"] = 2] = "id";
    DataType[DataType["type"] = 3] = "type";
    DataType[DataType["value"] = 4] = "value";
    DataType[DataType["guildId"] = 5] = "guildId";
})(DataType || (exports.DataType = DataType = {}));
var VariableType;
(function (VariableType) {
    VariableType[VariableType["user"] = 0] = "user";
    VariableType[VariableType["channel"] = 1] = "channel";
    VariableType[VariableType["role"] = 2] = "role";
    VariableType[VariableType["message"] = 3] = "message";
    VariableType[VariableType["member"] = 4] = "member";
    VariableType[VariableType["custom"] = 5] = "custom";
    VariableType[VariableType["guild"] = 6] = "guild";
    VariableType[VariableType["old"] = 7] = "old";
})(VariableType || (exports.VariableType = VariableType = {}));
function driverKind(type) {
    switch (type) {
        case "mysql":
        case "mariadb":
            return "mysql";
        case "postgres":
            return "postgres";
        case "mongodb":
            return "mongodb";
        default:
            return "sqlite";
    }
}
/** Reads 64-bit integer columns, which `pg` and `mysql2` return as strings, as numbers. */
const bigintToNumber = {
    to: (value) => value,
    from: (value) => (value === null || value === undefined ? value : Number(value)),
};
/*
 * Never change the type or length of an existing column below. TypeORM
 * synchronizes the schema, and on PostgreSQL and MySQL it changes a column by
 * dropping and re-creating it, which deletes its data. Adding indexes and
 * nullable columns is safe.
 */
let MySQLRecord = class MySQLRecord {
    identifier;
    name;
    id;
    type;
    value;
    guildId;
};
exports.MySQLRecord = MySQLRecord;
__decorate([
    (0, typeorm_1.PrimaryColumn)(),
    __metadata("design:type", String)
], MySQLRecord.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MySQLRecord.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], MySQLRecord.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MySQLRecord.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)("longtext"),
    __metadata("design:type", String)
], MySQLRecord.prototype, "value", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], MySQLRecord.prototype, "guildId", void 0);
exports.MySQLRecord = MySQLRecord = __decorate([
    (0, typeorm_1.Entity)("record"),
    (0, typeorm_1.Index)("IDX_record_name_type_guild", ["name", "type", "guildId"])
], MySQLRecord);
/**
 * The same table without the leaderboard index, used only when a MySQL server
 * refuses the index (MySQL 5.6 and old MariaDB limit index keys to 767 bytes).
 */
let MySQLRecordWithoutIndex = class MySQLRecordWithoutIndex {
    identifier;
    name;
    id;
    type;
    value;
    guildId;
};
exports.MySQLRecordWithoutIndex = MySQLRecordWithoutIndex;
__decorate([
    (0, typeorm_1.PrimaryColumn)(),
    __metadata("design:type", String)
], MySQLRecordWithoutIndex.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MySQLRecordWithoutIndex.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], MySQLRecordWithoutIndex.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MySQLRecordWithoutIndex.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)("longtext"),
    __metadata("design:type", String)
], MySQLRecordWithoutIndex.prototype, "value", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], MySQLRecordWithoutIndex.prototype, "guildId", void 0);
exports.MySQLRecordWithoutIndex = MySQLRecordWithoutIndex = __decorate([
    (0, typeorm_1.Entity)("record")
], MySQLRecordWithoutIndex);
let PostgreSQLRecord = class PostgreSQLRecord {
    identifier;
    name;
    id;
    type;
    value;
    guildId;
};
exports.PostgreSQLRecord = PostgreSQLRecord;
__decorate([
    (0, typeorm_1.PrimaryColumn)(),
    __metadata("design:type", String)
], PostgreSQLRecord.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], PostgreSQLRecord.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], PostgreSQLRecord.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], PostgreSQLRecord.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)("text"),
    __metadata("design:type", String)
], PostgreSQLRecord.prototype, "value", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], PostgreSQLRecord.prototype, "guildId", void 0);
exports.PostgreSQLRecord = PostgreSQLRecord = __decorate([
    (0, typeorm_1.Entity)("record"),
    (0, typeorm_1.Index)("IDX_record_name_type_guild", ["name", "type", "guildId"])
], PostgreSQLRecord);
let SQLiteRecord = class SQLiteRecord {
    identifier;
    name;
    id;
    type;
    value;
    guildId;
};
exports.SQLiteRecord = SQLiteRecord;
__decorate([
    (0, typeorm_1.PrimaryColumn)(),
    __metadata("design:type", String)
], SQLiteRecord.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], SQLiteRecord.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], SQLiteRecord.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], SQLiteRecord.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], SQLiteRecord.prototype, "value", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], SQLiteRecord.prototype, "guildId", void 0);
exports.SQLiteRecord = SQLiteRecord = __decorate([
    (0, typeorm_1.Entity)("record"),
    (0, typeorm_1.Index)("IDX_record_name_type_guild", ["name", "type", "guildId"])
], SQLiteRecord);
/** SQLite cooldowns. SQLite integers are 64-bit, so these columns hold millisecond timestamps. */
let Cooldown = class Cooldown {
    identifier;
    name;
    id;
    startedAt;
    duration;
};
exports.Cooldown = Cooldown;
__decorate([
    (0, typeorm_1.PrimaryColumn)(),
    __metadata("design:type", String)
], Cooldown.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Cooldown.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Cooldown.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], Cooldown.prototype, "startedAt", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], Cooldown.prototype, "duration", void 0);
exports.Cooldown = Cooldown = __decorate([
    (0, typeorm_1.Entity)()
], Cooldown);
/**
 * MySQL and PostgreSQL cooldowns. ForgeDB used 32-bit `integer` columns here,
 * which cannot hold a millisecond timestamp: every cooldown write failed on
 * these databases. `bigint` holds any timestamp and any duration.
 */
let SQLCooldown = class SQLCooldown {
    identifier;
    name;
    id;
    startedAt;
    duration;
};
exports.SQLCooldown = SQLCooldown;
__decorate([
    (0, typeorm_1.PrimaryColumn)(),
    __metadata("design:type", String)
], SQLCooldown.prototype, "identifier", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], SQLCooldown.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], SQLCooldown.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "bigint", transformer: bigintToNumber }),
    __metadata("design:type", Number)
], SQLCooldown.prototype, "startedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "bigint", transformer: bigintToNumber }),
    __metadata("design:type", Number)
], SQLCooldown.prototype, "duration", void 0);
exports.SQLCooldown = SQLCooldown = __decorate([
    (0, typeorm_1.Entity)("cooldown")
], SQLCooldown);
/*
 * MongoDB keys documents by `_id`, so `identifier` gets its own index: without
 * it every read was a full collection scan. Non-unique on purpose: ForgeDB's
 * old read-then-write could leave duplicates, and a unique index would refuse
 * to build on such a collection and stop the bot from starting. The
 * name/type/guildId index is inherited from SQLiteRecord.
 */
let MongoRecord = class MongoRecord extends SQLiteRecord {
    mongoId;
};
exports.MongoRecord = MongoRecord;
__decorate([
    (0, typeorm_1.ObjectIdColumn)(),
    __metadata("design:type", String)
], MongoRecord.prototype, "mongoId", void 0);
exports.MongoRecord = MongoRecord = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)("IDX_mongo_record_identifier", ["identifier"])
], MongoRecord);
let MongoCooldown = class MongoCooldown extends Cooldown {
    mongoId;
};
exports.MongoCooldown = MongoCooldown;
__decorate([
    (0, typeorm_1.ObjectIdColumn)(),
    __metadata("design:type", String)
], MongoCooldown.prototype, "mongoId", void 0);
exports.MongoCooldown = MongoCooldown = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)("IDX_mongo_cooldown_identifier", ["identifier"])
], MongoCooldown);
//# sourceMappingURL=types.js.map