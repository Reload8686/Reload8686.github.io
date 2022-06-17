// Tests the basic API of the getDefaultRWConcern and setDefaultRWConcern commands and their
// associated persisted state against different topologies.
// @tags: [requires_fcv_50]
(function() {
"use strict";

load("jstests/libs/write_concern_util.js");  // For isDefaultWriteConcernMajorityFlagEnabled.
load('jstests/replsets/rslib.js');           // For isDefaultReadConcernLocalFlagEnabled.

// Asserts a set/get default RWC command response or persisted document contains the expected
// fields. Assumes a default read or write concern has been set previously and the response was not
// generated by a getDefaultRWConcern command with inMemory=true.
function verifyFields(res,
                      {expectRC, expectWC, isPersistedDocument},
                      isDefaultReadConcernLocalFlagEnabled,
                      isDefaultWCMajorityFlagEnabled,
                      isImplicitDefaultWCMajority) {
    // These fields are always set once a read or write concern has been set at least once.
    let expectedFields = ["updateOpTime", "updateWallClockTime", "localUpdateWallClockTime"];
    let unexpectedFields = ["inMemory"];

    if (expectRC || (isDefaultReadConcernLocalFlagEnabled && !isPersistedDocument)) {
        expectedFields.push("defaultReadConcern");
    } else {
        unexpectedFields.push("defaultReadConcern");
    }

    if (isDefaultReadConcernLocalFlagEnabled && !isPersistedDocument) {
        expectedFields.push("defaultReadConcernSource");
    } else {
        unexpectedFields.push("defaultReadConcernSource");
    }

    if (expectWC || (isImplicitDefaultWCMajority && !isPersistedDocument)) {
        expectedFields.push("defaultWriteConcern");
    } else {
        unexpectedFields.push("defaultWriteConcern");
    }

    if (isDefaultWCMajorityFlagEnabled && !isPersistedDocument) {
        expectedFields.push("defaultWriteConcernSource");
    } else {
        unexpectedFields.push("defaultWriteConcernSource");
    }

    // localUpdateWallClockTime is generated by the in-memory cache and is not stored in the
    // persisted document.
    if (isPersistedDocument) {
        expectedFields = expectedFields.filter(field => field !== "localUpdateWallClockTime");
        unexpectedFields.push("localUpdateWallClockTime");
    }

    assert.hasFields(res, expectedFields);
    unexpectedFields.forEach(field => {
        assert(!res.hasOwnProperty(field),
               `response unexpectedly had field '${field}', res: ${tojson(res)}`);
    });
    if (isDefaultWCMajorityFlagEnabled && !isPersistedDocument) {
        if (expectWC) {
            assert.eq(res.defaultWriteConcernSource, "global", tojson(res));
        } else {
            assert.eq(res.defaultWriteConcernSource, "implicit", tojson(res));
        }
    }
}

function verifyDefaultRWCommandsInvalidInput(conn) {
    //
    // Test invalid parameters for getDefaultRWConcern.
    //

    // Invalid inMemory.
    assert.commandFailedWithCode(conn.adminCommand({getDefaultRWConcern: 1, inMemory: "true"}),
                                 ErrorCodes.TypeMismatch);

    //
    // Test invalid parameters for setDefaultRWConcern.
    //

    // Must include either wc or rc.
    assert.commandFailedWithCode(conn.adminCommand({setDefaultRWConcern: 1}), ErrorCodes.BadValue);

    // Invalid write concern.
    assert.commandFailedWithCode(
        conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: 1}),
        ErrorCodes.TypeMismatch);

    // w less than 1.
    assert.commandFailedWithCode(conn.adminCommand({
        setDefaultRWConcern: 1,
        defaultWriteConcern: {w: 0},
    }),
                                 ErrorCodes.BadValue);

    // Empty write concern is not allowed if write concern has already been set.
    const featureEnabled = assert
                               .commandWorked(conn.adminCommand(
                                   {getParameter: 1, featureFlagDefaultWriteConcernMajority: 1}))
                               .featureFlagDefaultWriteConcernMajority.value;
    if (featureEnabled) {
        assert.commandFailedWithCode(
            conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: {}}),
            ErrorCodes.IllegalOperation);
    }

    // Invalid read concern.
    assert.commandFailedWithCode(conn.adminCommand({setDefaultRWConcern: 1, defaultReadConcern: 1}),
                                 ErrorCodes.TypeMismatch);

    // Non-existent level.
    assert.commandFailedWithCode(
        conn.adminCommand({setDefaultRWConcern: 1, defaultReadConcern: {level: "dummy"}}),
        ErrorCodes.FailedToParse);

    // Unsupported level.
    assert.commandFailedWithCode(
        conn.adminCommand({setDefaultRWConcern: 1, defaultReadConcern: {level: "linearizable"}}),
        ErrorCodes.BadValue);
    assert.commandFailedWithCode(
        conn.adminCommand({setDefaultRWConcern: 1, defaultReadConcern: {level: "snapshot"}}),
        ErrorCodes.BadValue);

    // Fields other than level.
    assert.commandFailedWithCode(conn.adminCommand({
        setDefaultRWConcern: 1,
        defaultReadConcern: {level: "local", afterClusterTime: Timestamp(50, 1)}
    }),
                                 ErrorCodes.BadValue);
    assert.commandFailedWithCode(conn.adminCommand({
        setDefaultRWConcern: 1,
        defaultReadConcern: {level: "snapshot", atClusterTime: Timestamp(50, 1)}
    }),
                                 ErrorCodes.BadValue);
    assert.commandFailedWithCode(conn.adminCommand({
        setDefaultRWConcern: 1,
        defaultReadConcern: {level: "local", afterOpTime: {ts: Timestamp(50, 1), t: 1}}
    }),
                                 ErrorCodes.BadValue);
}

// Verifies the default responses for the default RWC commands and the default persisted state.
function verifyDefaultState(conn,
                            isDefaultRCLocalFlagEnabled,
                            isDefaultWCMajorityFlagEnabled,
                            isImplicitDefaultWCMajority) {
    const res = assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1}));
    const inMemoryRes =
        assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1, inMemory: true}));

    // localUpdateWallClockTime is set when a node refreshes its defaults, even if none are found.
    const expectedFields = ["localUpdateWallClockTime"];
    if (isImplicitDefaultWCMajority) {
        expectedFields.push("defaultWriteConcern");
    }
    if (isDefaultWCMajorityFlagEnabled) {
        expectedFields.push("defaultWriteConcernSource");
    }

    if (isDefaultRCLocalFlagEnabled) {
        expectedFields.push("defaultReadConcern");
        expectedFields.push("defaultReadConcernSource");
    }

    expectedFields.forEach(field => {
        assert(res.hasOwnProperty(field),
               `response did not have field '${field}', res: ${tojson(res)}`);
        assert(inMemoryRes.hasOwnProperty(field),
               `inMemory=true response did not have field '${field}', res: ${tojson(inMemoryRes)}`);
    });
    assert.eq(inMemoryRes.inMemory, true, tojson(inMemoryRes));

    if (isDefaultWCMajorityFlagEnabled) {
        assert.eq(res.defaultWriteConcernSource, "implicit", tojson(res));
        assert.eq(inMemoryRes.defaultWriteConcernSource, "implicit", tojson(inMemoryRes));
    }

    // No other fields should be returned if neither a default read nor write concern has been set.
    const unexpectedFields = ["updateOpTime", "updateWallClockTime"];
    if (!isImplicitDefaultWCMajority) {
        unexpectedFields.push("defaultWriteConcern");
    }
    if (!isDefaultWCMajorityFlagEnabled) {
        unexpectedFields.push("defaultWriteConcernSource");
    }

    if (!isDefaultRCLocalFlagEnabled) {
        unexpectedFields.push("defaultReadConcern");
        unexpectedFields.push("defaultReadConcernSource");
    }
    unexpectedFields.forEach(field => {
        assert(!res.hasOwnProperty(field),
               `response unexpectedly had field '${field}', res: ${tojson(res)}`);
        assert(!inMemoryRes.hasOwnProperty(field),
               `inMemory=true response unexpectedly had field '${field}', res: ${
                   tojson(inMemoryRes)}`);
    });
    assert.eq(undefined, res.inMemory, tojson(res));

    // There should be no default RWC document.
    assert.eq(null, getPersistedRWCDocument(conn));
}

function verifyDefaultRWCommandsValidInputOnSuccess(conn,
                                                    isDefaultReadConcernLocalFlagEnabled,
                                                    isDefaultWCMajorityFlagEnabled,
                                                    isImplicitDefaultWCMajority) {
    //
    // Test getDefaultRWConcern when neither read nor write concern are set.
    //

    // No parameters is allowed.
    assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1}));

    // inMemory parameter is allowed.
    assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1, inMemory: true}));
    assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1, inMemory: false}));

    // An inMemory response should contain inMemory=true.
    const inMemoryRes =
        assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1, inMemory: true}));
    assert.eq(inMemoryRes.inMemory, true, tojson(inMemoryRes));

    //
    // Test getting and setting read concern.
    //

    // Test setDefaultRWConcern when only read concern is set.
    verifyFields(assert.commandWorked(conn.adminCommand(
                     {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}})),
                 {expectRC: true, expectWC: false},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);
    verifyFields(getPersistedRWCDocument(conn),
                 {expectRC: true, expectWC: false, isPersistedDocument: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    // Test getDefaultRWConcern when only read concern is set.
    verifyFields(assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1})),
                 {expectRC: true, expectWC: false},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    // Test unsetting read concern.
    verifyFields(
        assert.commandWorked(conn.adminCommand({setDefaultRWConcern: 1, defaultReadConcern: {}})),
        {expectRC: false, expectWC: false},
        isDefaultReadConcernLocalFlagEnabled,
        isDefaultWCMajorityFlagEnabled,
        isImplicitDefaultWCMajority);
    verifyFields(getPersistedRWCDocument(conn),
                 {expectRC: false, expectWC: false, isPersistedDocument: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);
    verifyFields(assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1})),
                 {expectRC: false, expectWC: false},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    //
    // Test getting and setting write concern.
    //

    // Empty write concern is allowed if write concern has not already been set.
    verifyFields(
        assert.commandWorked(conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: {}})),
        {expectRC: false, expectWC: false},
        isDefaultReadConcernLocalFlagEnabled,
        isDefaultWCMajorityFlagEnabled,
        isImplicitDefaultWCMajority);
    verifyFields(getPersistedRWCDocument(conn),
                 {expectRC: false, expectWC: false, isPersistedDocument: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    // Test setRWConcern when only write concern is set.
    assert.commandWorked(conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: {w: 1}}));
    assert.commandWorked(
        conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: {w: 1, j: false}}));
    assert.commandWorked(
        conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: {w: "majority"}}));

    verifyFields(assert.commandWorked(
                     conn.adminCommand({setDefaultRWConcern: 1, defaultWriteConcern: {w: 1}})),
                 {expectRC: false, expectWC: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);
    verifyFields(getPersistedRWCDocument(conn),
                 {expectRC: false, expectWC: true, isPersistedDocument: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    // Test getRWConcern when only write concern is set.
    verifyFields(assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1})),
                 {expectRC: false, expectWC: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    //
    // Test getting and setting both read and write concern.
    //
    verifyFields(assert.commandWorked(conn.adminCommand({
        setDefaultRWConcern: 1,
        defaultReadConcern: {level: "local"},
        defaultWriteConcern: {w: 1}
    })),
                 {expectRC: true, expectWC: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);
    verifyFields(getPersistedRWCDocument(conn),
                 {expectRC: true, expectWC: true, isPersistedDocument: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);

    // Test getRWConcern when both read and write concern are set.
    verifyFields(assert.commandWorked(conn.adminCommand({getDefaultRWConcern: 1})),
                 {expectRC: true, expectWC: true},
                 isDefaultReadConcernLocalFlagEnabled,
                 isDefaultWCMajorityFlagEnabled,
                 isImplicitDefaultWCMajority);
}

function getPersistedRWCDocument(conn) {
    return conn.getDB("config").settings.findOne({_id: "ReadWriteConcernDefaults"});
}

// Verifies the error code returned by connections to nodes that do not support the get/set default
// rw concern commands.
function verifyDefaultRWCommandsFailWithCode(conn, {failureCode}) {
    assert.commandFailedWithCode(conn.adminCommand({getDefaultRWConcern: 1}), failureCode);
    assert.commandFailedWithCode(
        conn.adminCommand({setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        failureCode);
}

jsTestLog("Testing standalone mongod...");
{
    const standalone = MongoRunner.runMongod();

    // Standalone node fails.
    verifyDefaultRWCommandsFailWithCode(standalone, {failureCode: 51300});

    MongoRunner.stopMongod(standalone);
}

jsTestLog("Testing standalone replica set with implicit default write concern majority...");
{
    const rst = new ReplSetTest({nodes: 2});
    rst.startSet();
    rst.initiate();

    // Primary succeeds.
    const primary = rst.getPrimary();

    const isDefaultRCLocalFlagEnabled = isDefaultReadConcernLocalFlagEnabled(primary);
    const isDefaultWCMajorityFlagEnabled = isDefaultWriteConcernMajorityFlagEnabled(primary);
    const isImplicitDefaultWCMajority = isDefaultWCMajorityFlagEnabled;
    verifyDefaultState(primary,
                       isDefaultRCLocalFlagEnabled,
                       isDefaultWCMajorityFlagEnabled,
                       isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsValidInputOnSuccess(primary,
                                               isDefaultRCLocalFlagEnabled,
                                               isDefaultWCMajorityFlagEnabled,
                                               isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsInvalidInput(primary);

    // Secondary can run getDefaultRWConcern, but not setDefaultRWConcern.
    assert.commandWorked(rst.getSecondary().adminCommand({getDefaultRWConcern: 1}));
    assert.commandFailedWithCode(
        rst.getSecondary().adminCommand(
            {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        ErrorCodes.NotWritablePrimary);

    rst.stopSet();
}

jsTestLog("Testing standalone replica set with implicit default write concern {w:1}...");
{
    const rst = new ReplSetTest({nodes: [{}, {}, {arbiter: true}]});
    rst.startSet();
    rst.initiate();

    // Primary succeeds.
    const primary = rst.getPrimary();

    const isDefaultRCLocalFlagEnabled = isDefaultReadConcernLocalFlagEnabled(primary);
    const isDefaultWCMajorityFlagEnabled = isDefaultWriteConcernMajorityFlagEnabled(primary);
    verifyDefaultState(primary,
                       isDefaultRCLocalFlagEnabled,
                       isDefaultWCMajorityFlagEnabled,
                       false /* isImplicitDefaultWCMajority */);
    verifyDefaultRWCommandsValidInputOnSuccess(primary,
                                               isDefaultRCLocalFlagEnabled,
                                               isDefaultWCMajorityFlagEnabled,
                                               false /* isImplicitDefaultWCMajority */);
    verifyDefaultRWCommandsInvalidInput(primary);

    // Secondary can run getDefaultRWConcern, but not setDefaultRWConcern.
    assert.commandWorked(rst.getSecondary().adminCommand({getDefaultRWConcern: 1}));
    assert.commandFailedWithCode(
        rst.getSecondary().adminCommand(
            {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        ErrorCodes.NotWritablePrimary);

    rst.stopSet();
}

jsTestLog("Testing sharded cluster with implicit default write concern majority...");
{
    let st = new ShardingTest({shards: 1, rs: {nodes: 2}});

    // Mongos succeeds.
    let isDefaultRCLocalFlagEnabled = isDefaultReadConcernLocalFlagEnabled(st.s);
    let isDefaultWCMajorityFlagEnabled = isDefaultWriteConcernMajorityFlagEnabled(st.s);
    let isImplicitDefaultWCMajority = isDefaultWCMajorityFlagEnabled;
    verifyDefaultState(st.s,
                       isDefaultRCLocalFlagEnabled,
                       isDefaultWCMajorityFlagEnabled,
                       isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsValidInputOnSuccess(st.s,
                                               isDefaultRCLocalFlagEnabled,
                                               isDefaultWCMajorityFlagEnabled,
                                               isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsInvalidInput(st.s);

    // Shard node fails.
    verifyDefaultRWCommandsFailWithCode(st.rs0.getPrimary(), {failureCode: 51301});
    assert.commandFailedWithCode(st.rs0.getSecondary().adminCommand({getDefaultRWConcern: 1}),
                                 51301);
    // Secondaries fail setDefaultRWConcern before executing the command.
    assert.commandFailedWithCode(
        st.rs0.getSecondary().adminCommand(
            {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        ErrorCodes.NotWritablePrimary);

    st.stop();
    st = new ShardingTest({shards: 1, rs: {nodes: 2}});
    // Config server primary succeeds.
    isDefaultRCLocalFlagEnabled = isDefaultReadConcernLocalFlagEnabled(st.configRS.getPrimary());
    isDefaultWCMajorityFlagEnabled =
        isDefaultWriteConcernMajorityFlagEnabled(st.configRS.getPrimary());
    isImplicitDefaultWCMajority = isDefaultWCMajorityFlagEnabled;
    verifyDefaultState(st.configRS.getPrimary(),
                       isDefaultRCLocalFlagEnabled,
                       isDefaultWCMajorityFlagEnabled,
                       isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsValidInputOnSuccess(st.configRS.getPrimary(),
                                               isDefaultRCLocalFlagEnabled,
                                               isDefaultWCMajorityFlagEnabled,
                                               isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsInvalidInput(st.configRS.getPrimary());

    // Config server secondary can run getDefaultRWConcern, but not setDefaultRWConcern.
    assert.commandWorked(st.configRS.getSecondary().adminCommand({getDefaultRWConcern: 1}));
    assert.commandFailedWithCode(
        st.configRS.getSecondary().adminCommand(
            {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        ErrorCodes.NotWritablePrimary);

    st.stop();
}

jsTestLog("Testing sharded cluster with a PSA replica set...");
{
    let st = new ShardingTest({shards: 1, rs: {nodes: [{}, {}, {arbiter: true}]}});

    // Mongos succeeds.
    let isDefaultRCLocalFlagEnabled = isDefaultReadConcernLocalFlagEnabled(st.s);
    let isDefaultWCMajorityFlagEnabled = isDefaultWriteConcernMajorityFlagEnabled(st.s);
    let isImplicitDefaultWCMajority = isDefaultWCMajorityFlagEnabled;
    verifyDefaultState(st.s,
                       isDefaultRCLocalFlagEnabled,
                       isDefaultWCMajorityFlagEnabled,
                       isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsValidInputOnSuccess(st.s,
                                               isDefaultRCLocalFlagEnabled,
                                               isDefaultWCMajorityFlagEnabled,
                                               isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsInvalidInput(st.s);

    // Shard node fails.
    verifyDefaultRWCommandsFailWithCode(st.rs0.getPrimary(), {failureCode: 51301});
    assert.commandFailedWithCode(st.rs0.getSecondary().adminCommand({getDefaultRWConcern: 1}),
                                 51301);
    // Secondaries fail setDefaultRWConcern before executing the command.
    assert.commandFailedWithCode(
        st.rs0.getSecondary().adminCommand(
            {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        ErrorCodes.NotWritablePrimary);

    st.stop();
    st = new ShardingTest({shards: 1, rs: {nodes: 2}});
    // Config server primary succeeds.
    isDefaultRCLocalFlagEnabled = isDefaultReadConcernLocalFlagEnabled(st.configRS.getPrimary());
    isDefaultWCMajorityFlagEnabled =
        isDefaultWriteConcernMajorityFlagEnabled(st.configRS.getPrimary());
    isImplicitDefaultWCMajority = isDefaultWCMajorityFlagEnabled;
    verifyDefaultState(st.configRS.getPrimary(),
                       isDefaultRCLocalFlagEnabled,
                       isDefaultWCMajorityFlagEnabled,
                       isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsValidInputOnSuccess(st.configRS.getPrimary(),
                                               isDefaultRCLocalFlagEnabled,
                                               isDefaultWCMajorityFlagEnabled,
                                               isImplicitDefaultWCMajority);
    verifyDefaultRWCommandsInvalidInput(st.configRS.getPrimary());

    // Config server secondary can run getDefaultRWConcern, but not setDefaultRWConcern.
    assert.commandWorked(st.configRS.getSecondary().adminCommand({getDefaultRWConcern: 1}));
    assert.commandFailedWithCode(
        st.configRS.getSecondary().adminCommand(
            {setDefaultRWConcern: 1, defaultReadConcern: {level: "local"}}),
        ErrorCodes.NotWritablePrimary);

    st.stop();
}
})();
