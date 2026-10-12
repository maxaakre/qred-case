# 404, not 403, when the user has no access

A user asking for a company or card they are not allowed to see gets `404 Not Found`, the same as for one that does not exist. A `403` would confirm that the id exists, which leaks information about other customers. The cost is that "not found" can mean "not yours", which we document in the contract.
