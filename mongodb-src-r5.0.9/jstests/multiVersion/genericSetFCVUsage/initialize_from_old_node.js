/*
 * This is a regression test for SERVER-16189, to make sure a replica set with both current and
 * prior version nodes can be initialized from the prior version node.
 */

(function() {
"use strict";
var name = "initialize_from_old";
// Test old version with "last-lts".
{
    let oldVersion = "last-lts";
    jsTestLog("Testing replSetInitiate with " + oldVersion);
    var newVersion = 'latest';
    var nodes = {
        n0: {binVersion: oldVersion},
        n1: {binVersion: newVersion},
        n2: {binVersion: newVersion}
    };
    var rst = new ReplSetTest({nodes: nodes, name: name});
    var conns = rst.startSet();
    var oldNode = conns[0];
    var config = rst.getReplSetConfig();
    var response = oldNode.getDB("admin").runCommand({replSetInitiate: config});
    assert.commandWorked(response);
    // Wait for secondaries to finish their initial sync before shutting down the cluster.
    rst.awaitSecondaryNodes();
    rst.stopSet();
}
})();
