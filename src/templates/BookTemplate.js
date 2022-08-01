import React from "react";
import { graphql } from "gatsby";

import PageBook from "miko/src/components/PageBook";

export default function BookTemplate(props) {
  return <PageBook {...props} />;
}

export const pageQuery = graphql`
  query BookByName($name: String!) {
    bookMeta: json(name: { eq: $name }) {
      dimensions
      name
    }
    bookPages: allFile(
      sort: { fields: relativePath }
      filter: {
        relativeDirectory: { eq: $name }
        extension: { nin: ["json"] }
        name: { regex: "/^(?!thumbnail).*/" }
      }
    ) {
      edges {
        node {
          relativePath
          publicURL
          name
        }
      }
    }
  }
`;
